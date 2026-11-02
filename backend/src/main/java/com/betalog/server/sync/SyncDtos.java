package com.betalog.server.sync;

import java.util.List;

/** Wire format shared with the React app (frontend/src/data/sync.ts). Times are epoch milliseconds. */
public final class SyncDtos {
    private SyncDtos() {
    }

    public record ProblemDto(String id, String gym, int grade, String sector, String memo, long createdAt, long updatedAt,
                             boolean deleted, String marks, boolean hasPhoto, int videoCount) {
        static ProblemDto of(ProblemEntity e) {
            return new ProblemDto(e.getId(), e.getGym(), e.getGrade(), e.getSector(), e.getMemo(), e.getCreatedAt(), e.getUpdatedAt(),
                    e.isDeleted(), e.getMarks(), e.isHasPhoto(), e.getVideoCount());
        }
    }

    public record AttemptDto(String id, String problemId, int attempts, String result, long date, long updatedAt, boolean deleted) {
        static AttemptDto of(AttemptEntity e) {
            return new AttemptDto(e.getId(), e.getProblemId(), e.getAttempts(), e.getResult().name(), e.getDate(), e.getUpdatedAt(), e.isDeleted());
        }
    }

    /** Changes made on the phone since its last sync, plus the cursor it got last time. */
    public record SyncRequest(long since, List<ProblemDto> problems, List<AttemptDto> attempts) {
        public List<ProblemDto> problemsOrEmpty() { return problems == null ? List.of() : problems; }
        public List<AttemptDto> attemptsOrEmpty() { return attempts == null ? List.of() : attempts; }
    }

    /** Everything that changed on the server after `since`, and the new cursor to send next time. */
    public record SyncResponse(long cursor, List<ProblemDto> problems, List<AttemptDto> attempts) {}
}
