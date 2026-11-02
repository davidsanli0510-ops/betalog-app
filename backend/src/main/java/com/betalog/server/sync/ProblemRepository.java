package com.betalog.server.sync;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface ProblemRepository extends JpaRepository<ProblemEntity, String> {
    List<ProblemEntity> findByUserIdAndServerUpdatedAtGreaterThanOrderByServerUpdatedAtAsc(Long userId, long since);

    @Query("select coalesce(max(p.serverUpdatedAt), 0) from ProblemEntity p")
    long maxSeq();
}
