package com.betalog.server.sync;

import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.betalog.server.common.ApiException;
import com.betalog.server.sync.SyncDtos.AttemptDto;
import com.betalog.server.sync.SyncDtos.ProblemDto;
import com.betalog.server.sync.SyncDtos.SyncRequest;
import com.betalog.server.sync.SyncDtos.SyncResponse;

import jakarta.annotation.PostConstruct;

/**
 * Offline-first sync. Phones push rows they changed and pull rows changed after their cursor.
 * Conflicts: the edit with the newer phone timestamp (updatedAt) wins. Deletes are rows with deleted=true.
 */
@Service
public class SyncService {
    static final int MAX_BATCH = 2000;

    private final ProblemRepository problems;
    private final AttemptRepository attempts;
    /** monotonic change counter (based on wall time so it survives restarts) */
    private final AtomicLong seq = new AtomicLong();

    public SyncService(ProblemRepository problems, AttemptRepository attempts) {
        this.problems = problems;
        this.attempts = attempts;
    }

    @PostConstruct
    void initSeq() {
        seq.set(Math.max(problems.maxSeq(), attempts.maxSeq()));
    }

    private long nextSeq() {
        long now = System.currentTimeMillis();
        return seq.updateAndGet(prev -> Math.max(prev + 1, now));
    }

    @Transactional
    public SyncResponse sync(long userId, SyncRequest req) {
        List<ProblemDto> inP = req.problemsOrEmpty();
        List<AttemptDto> inA = req.attemptsOrEmpty();
        if (inP.size() + inA.size() > MAX_BATCH) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "한 번에 올릴 변경이 너무 많아요.");

        for (ProblemDto d : inP) {
            validate(d);
            ProblemEntity e = problems.findById(d.id()).orElse(null);
            if (e != null && !e.getUserId().equals(userId)) continue; // never touch someone else's row
            if (e != null && d.updatedAt() < e.getUpdatedAt()) continue; // server already has a newer edit
            if (e == null) e = new ProblemEntity(d.id(), userId);
            e.setGym(d.gym());
            e.setGrade(d.grade());
            e.setSector(trim(d.sector(), 40));
            e.setMemo(trim(d.memo(), 2000));
            e.setMarks(d.marks() == null || d.marks().length() > 8000 ? "[]" : d.marks());
            e.setHasPhoto(d.hasPhoto());
            e.setVideoCount(Math.max(0, d.videoCount()));
            e.setCreatedAt(d.createdAt());
            e.setUpdatedAt(d.updatedAt());
            e.setDeleted(d.deleted());
            e.setServerUpdatedAt(nextSeq());
            problems.save(e);
        }
        for (AttemptDto d : inA) {
            AttemptEntity.Result result = validate(d);
            AttemptEntity e = attempts.findById(d.id()).orElse(null);
            if (e != null && !e.getUserId().equals(userId)) continue;
            if (e != null && d.updatedAt() < e.getUpdatedAt()) continue;
            ProblemEntity parent = problems.findById(d.problemId()).orElse(null);
            if (parent != null && !parent.getUserId().equals(userId)) continue;
            if (e == null) e = new AttemptEntity(d.id(), userId);
            e.setProblemId(d.problemId());
            e.setAttempts(d.attempts());
            e.setResult(result);
            e.setDate(d.date());
            e.setUpdatedAt(d.updatedAt());
            e.setDeleted(d.deleted());
            e.setServerUpdatedAt(nextSeq());
            attempts.save(e);
        }

        List<ProblemEntity> outP = problems.findByUserIdAndServerUpdatedAtGreaterThanOrderByServerUpdatedAtAsc(userId, req.since());
        List<AttemptEntity> outA = attempts.findByUserIdAndServerUpdatedAtGreaterThanOrderByServerUpdatedAtAsc(userId, req.since());
        long cursor = req.since();
        for (ProblemEntity p : outP) cursor = Math.max(cursor, p.getServerUpdatedAt());
        for (AttemptEntity a : outA) cursor = Math.max(cursor, a.getServerUpdatedAt());
        return new SyncResponse(cursor, outP.stream().map(ProblemDto::of).toList(), outA.stream().map(AttemptDto::of).toList());
    }

    private static void validate(ProblemDto d) {
        if (d.id() == null || d.id().isBlank() || d.id().length() > 64) throw bad("문제 ID가 올바르지 않아요.");
        if (d.gym() == null || d.gym().isBlank() || d.gym().length() > 20) throw bad("지점 값이 올바르지 않아요.");
        if (d.grade() < 0 || d.grade() > 30) throw bad("난이도 값이 올바르지 않아요.");
    }

    private static AttemptEntity.Result validate(AttemptDto d) {
        if (d.id() == null || d.id().isBlank() || d.id().length() > 64) throw bad("기록 ID가 올바르지 않아요.");
        if (d.problemId() == null || d.problemId().isBlank() || d.problemId().length() > 64) throw bad("기록의 문제 ID가 올바르지 않아요.");
        if (d.attempts() < 1 || d.attempts() > 9999) throw bad("시도 횟수가 올바르지 않아요.");
        try {
            return AttemptEntity.Result.valueOf(d.result());
        } catch (IllegalArgumentException | NullPointerException e) {
            throw bad("결과 값이 올바르지 않아요.");
        }
    }

    private static ApiException bad(String m) {
        return new ApiException(HttpStatus.BAD_REQUEST, m);
    }

    private static String trim(String s, int max) {
        if (s == null) return "";
        return s.length() > max ? s.substring(0, max) : s;
    }
}
