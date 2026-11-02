package com.betalog.server.auth;

import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.betalog.server.common.ApiException;

@RestController
public class AuthController {
    private static final Pattern USERNAME = Pattern.compile("^[a-zA-Z0-9_.-]{3,30}$");

    public record AuthRequest(String username, String password, String displayName) {}
    public record AuthResponse(String token, String username, String displayName) {}
    public record MeResponse(long id, String username, String displayName) {}

    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final JwtService jwt;

    public AuthController(UserRepository users, PasswordEncoder encoder, JwtService jwt) {
        this.users = users;
        this.encoder = encoder;
        this.jwt = jwt;
    }

    @PostMapping("/api/auth/signup")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public AuthResponse signup(@RequestBody AuthRequest req) {
        String username = req.username() == null ? "" : req.username().trim();
        String password = req.password() == null ? "" : req.password();
        if (!USERNAME.matcher(username).matches()) throw new ApiException(HttpStatus.BAD_REQUEST, "아이디는 영문·숫자·._- 로 3~30자예요.");
        if (password.length() < 6 || password.length() > 100) throw new ApiException(HttpStatus.BAD_REQUEST, "비밀번호는 6자 이상이에요.");
        if (users.existsByUsernameIgnoreCase(username)) throw new ApiException(HttpStatus.CONFLICT, "이미 있는 아이디예요. 다른 아이디를 쓰거나 로그인하세요.");
        String name = req.displayName() == null || req.displayName().isBlank() ? username : req.displayName().trim();
        if (name.length() > 30) name = name.substring(0, 30);
        UserAccount u = users.save(new UserAccount(username, encoder.encode(password), name));
        return new AuthResponse(jwt.issue(u.getId()), u.getUsername(), u.getDisplayName());
    }

    @PostMapping("/api/auth/login")
    public AuthResponse login(@RequestBody AuthRequest req) {
        String username = req.username() == null ? "" : req.username().trim();
        UserAccount u = users.findByUsernameIgnoreCase(username)
                .filter(x -> req.password() != null && encoder.matches(req.password(), x.getPasswordHash()))
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "아이디나 비밀번호가 맞지 않아요."));
        return new AuthResponse(jwt.issue(u.getId()), u.getUsername(), u.getDisplayName());
    }

    @GetMapping("/api/me")
    public MeResponse me(@AuthenticationPrincipal Long userId) {
        UserAccount u = users.findById(userId).orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "로그인이 만료됐어요. 다시 로그인해 주세요."));
        return new MeResponse(u.getId(), u.getUsername(), u.getDisplayName());
    }
}
