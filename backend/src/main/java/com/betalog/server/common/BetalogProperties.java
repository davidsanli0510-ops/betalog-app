package com.betalog.server.common;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "betalog")
public record BetalogProperties(String jwtSecret, int jwtDays, String dataDir, String corsOrigins) {
    public BetalogProperties {
        if (jwtDays <= 0) jwtDays = 60;
        if (dataDir == null || dataDir.isBlank()) dataDir = "./data";
        if (corsOrigins == null || corsOrigins.isBlank()) corsOrigins = "*";
    }
}
