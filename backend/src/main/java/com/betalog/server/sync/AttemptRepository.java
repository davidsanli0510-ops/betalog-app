package com.betalog.server.sync;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface AttemptRepository extends JpaRepository<AttemptEntity, String> {
    List<AttemptEntity> findByUserIdAndServerUpdatedAtGreaterThanOrderByServerUpdatedAtAsc(Long userId, long since);

    @Query("select coalesce(max(a.serverUpdatedAt), 0) from AttemptEntity a")
    long maxSeq();
}
