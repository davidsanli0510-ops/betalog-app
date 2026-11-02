package com.betalog.server.sync;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

/** A problem a climber recorded. The id is created on the phone (UUID), so phones can work offline. */
@Entity
@Table(name = "problems", indexes = @Index(name = "idx_problems_user_seq", columnList = "userId,serverUpdatedAt"))
public class ProblemEntity {
    @Id
    @Column(length = 64)
    private String id;
    @Column(nullable = false)
    private Long userId;
    @Column(nullable = false, length = 20)
    private String gym;
    private int grade;
    @Column(length = 40)
    private String sector;
    @Column(length = 2000)
    private String memo;
    /** hold-sequence marks as JSON [{x,y}] in percent of the photo */
    @Column(length = 8000)
    private String marks;
    private boolean hasPhoto;
    private int videoCount;
    private long createdAt;
    /** last edit time on the phone — newest edit wins */
    private long updatedAt;
    private boolean deleted;
    /** server-side change counter used by phones to pull "everything since" */
    private long serverUpdatedAt;

    protected ProblemEntity() {
    }

    public ProblemEntity(String id, Long userId) {
        this.id = id;
        this.userId = userId;
    }

    public String getId() { return id; }
    public Long getUserId() { return userId; }
    public String getGym() { return gym; }
    public void setGym(String gym) { this.gym = gym; }
    public int getGrade() { return grade; }
    public void setGrade(int grade) { this.grade = grade; }
    public String getSector() { return sector; }
    public void setSector(String sector) { this.sector = sector; }
    public String getMemo() { return memo; }
    public void setMemo(String memo) { this.memo = memo; }
    public String getMarks() { return marks; }
    public void setMarks(String marks) { this.marks = marks; }
    public boolean isHasPhoto() { return hasPhoto; }
    public void setHasPhoto(boolean hasPhoto) { this.hasPhoto = hasPhoto; }
    public int getVideoCount() { return videoCount; }
    public void setVideoCount(int videoCount) { this.videoCount = videoCount; }
    public long getCreatedAt() { return createdAt; }
    public void setCreatedAt(long createdAt) { this.createdAt = createdAt; }
    public long getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(long updatedAt) { this.updatedAt = updatedAt; }
    public boolean isDeleted() { return deleted; }
    public void setDeleted(boolean deleted) { this.deleted = deleted; }
    public long getServerUpdatedAt() { return serverUpdatedAt; }
    public void setServerUpdatedAt(long serverUpdatedAt) { this.serverUpdatedAt = serverUpdatedAt; }
}
