package com.betalog.server.sync;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

/** One logged session on a problem: how many tries and the outcome. */
@Entity
@Table(name = "attempts", indexes = @Index(name = "idx_attempts_user_seq", columnList = "userId,serverUpdatedAt"))
public class AttemptEntity {
    public enum Result { FLASH, SEND, PROJECT }

    @Id
    @Column(length = 64)
    private String id;
    @Column(nullable = false)
    private Long userId;
    @Column(nullable = false, length = 64)
    private String problemId;
    private int attempts;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private Result result;
    @Column(name = "attempt_date")
    private long date;
    private long updatedAt;
    private boolean deleted;
    private long serverUpdatedAt;

    protected AttemptEntity() {
    }

    public AttemptEntity(String id, Long userId) {
        this.id = id;
        this.userId = userId;
    }

    public String getId() { return id; }
    public Long getUserId() { return userId; }
    public String getProblemId() { return problemId; }
    public void setProblemId(String problemId) { this.problemId = problemId; }
    public int getAttempts() { return attempts; }
    public void setAttempts(int attempts) { this.attempts = attempts; }
    public Result getResult() { return result; }
    public void setResult(Result result) { this.result = result; }
    public long getDate() { return date; }
    public void setDate(long date) { this.date = date; }
    public long getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(long updatedAt) { this.updatedAt = updatedAt; }
    public boolean isDeleted() { return deleted; }
    public void setDeleted(boolean deleted) { this.deleted = deleted; }
    public long getServerUpdatedAt() { return serverUpdatedAt; }
    public void setServerUpdatedAt(long serverUpdatedAt) { this.serverUpdatedAt = serverUpdatedAt; }
}
