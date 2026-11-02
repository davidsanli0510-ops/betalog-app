package com.betalog.server.common;

import org.springframework.http.HttpStatus;

/** An error whose message is safe to show to the user (the app displays it as-is). */
public class ApiException extends RuntimeException {
    private final HttpStatus status;

    public ApiException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
