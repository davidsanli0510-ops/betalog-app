package com.betalog.server.auth;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Date;

import javax.crypto.SecretKey;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.betalog.server.common.BetalogProperties;

import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

/** Issues and checks login tokens. The signing key comes from config or is generated once and kept in the data folder. */
@Service
public class JwtService {
    private static final Logger log = LoggerFactory.getLogger(JwtService.class);
    private final SecretKey key;
    private final Duration ttl;

    public JwtService(BetalogProperties props) {
        this.key = Keys.hmacShaKeyFor(loadSecret(props));
        this.ttl = Duration.ofDays(props.jwtDays());
    }

    private static byte[] loadSecret(BetalogProperties props) {
        String configured = props.jwtSecret();
        if (configured != null && !configured.isBlank()) {
            byte[] b = configured.getBytes(StandardCharsets.UTF_8);
            if (b.length < 32) throw new IllegalStateException("JWT_SECRET must be at least 32 characters");
            return b;
        }
        Path file = Path.of(props.dataDir(), "jwt.key");
        try {
            if (Files.exists(file)) return Base64.getDecoder().decode(Files.readString(file).trim());
            byte[] b = new byte[48];
            new SecureRandom().nextBytes(b);
            Files.createDirectories(file.getParent());
            Files.writeString(file, Base64.getEncoder().encodeToString(b));
            log.info("Generated a new token signing key at {}", file.toAbsolutePath());
            return b;
        } catch (IOException e) {
            throw new IllegalStateException("Could not read or create " + file.toAbsolutePath(), e);
        }
    }

    public String issue(long userId) {
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .subject(Long.toString(userId))
                .issuedAt(new Date(now))
                .expiration(new Date(now + ttl.toMillis()))
                .signWith(key)
                .compact();
    }

    /** @return the user id, or null when the token is missing, tampered with or expired */
    public Long verify(String token) {
        try {
            String sub = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload().getSubject();
            return Long.valueOf(sub);
        } catch (JwtException | IllegalArgumentException e) {
            return null;
        }
    }
}
