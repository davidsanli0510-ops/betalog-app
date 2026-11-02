package com.betalog.server.sync;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.betalog.server.sync.SyncDtos.SyncRequest;
import com.betalog.server.sync.SyncDtos.SyncResponse;

@RestController
public class SyncController {
    private final SyncService sync;

    public SyncController(SyncService sync) {
        this.sync = sync;
    }

    @PostMapping("/api/sync")
    public SyncResponse sync(@AuthenticationPrincipal Long userId, @RequestBody SyncRequest req) {
        return sync.sync(userId, req);
    }
}
