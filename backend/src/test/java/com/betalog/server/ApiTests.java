package com.betalog.server;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
class ApiTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    private String uniqueName() {
        return "u" + UUID.randomUUID().toString().substring(0, 8);
    }

    private String signup(String username) throws Exception {
        MvcResult r = mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("username", username, "password", "secret123", "displayName", "클라이머"))))
                .andExpect(status().isCreated()).andReturn();
        return json.readTree(r.getResponse().getContentAsString()).get("token").asText();
    }

    private JsonNode sync(String token, long since, List<?> problems, List<?> attempts) throws Exception {
        MvcResult r = mvc.perform(post("/api/sync").header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("since", since, "problems", problems, "attempts", attempts))))
                .andExpect(status().isOk()).andReturn();
        return json.readTree(r.getResponse().getContentAsString());
    }

    private static Map<String, Object> problem(String id, int grade, String memo, long updatedAt, boolean deleted) {
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", id); m.put("gym", "yj"); m.put("grade", grade); m.put("sector", "슬랩"); m.put("memo", memo);
        m.put("createdAt", 1000L); m.put("updatedAt", updatedAt); m.put("deleted", deleted);
        m.put("marks", "[{\"x\":10,\"y\":20}]"); m.put("hasPhoto", true); m.put("videoCount", 2);
        return m;
    }

    private static Map<String, Object> attempt(String id, String pid, String result, long updatedAt) {
        return Map.of("id", id, "problemId", pid, "attempts", 3, "result", result, "date", 2000L, "updatedAt", updatedAt, "deleted", false);
    }

    @Test
    void healthIsPublic() throws Exception {
        mvc.perform(get("/api/health")).andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(true));
    }

    @Test
    void signupLoginAndMe() throws Exception {
        String name = uniqueName();
        String token = signup(name);
        mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("username", name.toUpperCase(), "password", "secret123"))))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.message").exists());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("username", name, "password", "wrong-pass"))))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.message").value("아이디나 비밀번호가 맞지 않아요."));
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("username", name, "password", "secret123"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.token").exists()).andExpect(jsonPath("$.displayName").value("클라이머"));
        mvc.perform(get("/api/me").header("Authorization", "Bearer " + token)).andExpect(status().isOk()).andExpect(jsonPath("$.username").value(name));
    }

    @Test
    void rejectsBadSignup() throws Exception {
        mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("username", "a!", "password", "secret123")))).andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("username", uniqueName(), "password", "123")))).andExpect(status().isBadRequest());
    }

    @Test
    void syncNeedsLogin() throws Exception {
        mvc.perform(post("/api/sync").contentType(MediaType.APPLICATION_JSON).content("{\"since\":0}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.message").value("로그인이 필요해요."));
        mvc.perform(post("/api/sync").header("Authorization", "Bearer not-a-token").contentType(MediaType.APPLICATION_JSON).content("{\"since\":0}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void pushThenPullOnAnotherPhone() throws Exception {
        String token = signup(uniqueName());
        String pid = UUID.randomUUID().toString(), aid = UUID.randomUUID().toString();
        JsonNode r1 = sync(token, 0, List.of(problem(pid, 4, "왼발 하이스텝", 5000, false)), List.of(attempt(aid, pid, "SEND", 5000)));
        assertThat(r1.get("cursor").asLong()).isPositive();

        // a second phone with an empty cursor gets everything
        JsonNode r2 = sync(token, 0, List.of(), List.of());
        assertThat(r2.get("problems")).hasSize(1);
        assertThat(r2.get("problems").get(0).get("memo").asText()).isEqualTo("왼발 하이스텝");
        assertThat(r2.get("problems").get(0).get("marks").asText()).contains("\"x\":10");
        assertThat(r2.get("attempts").get(0).get("result").asText()).isEqualTo("SEND");

        // nothing new since the latest cursor
        JsonNode r3 = sync(token, r2.get("cursor").asLong(), List.of(), List.of());
        assertThat(r3.get("problems")).isEmpty();
        assertThat(r3.get("attempts")).isEmpty();
        assertThat(r3.get("cursor").asLong()).isEqualTo(r2.get("cursor").asLong());
    }

    @Test
    void newestEditWinsAndDeletesPropagate() throws Exception {
        String token = signup(uniqueName());
        String pid = UUID.randomUUID().toString();
        long c1 = sync(token, 0, List.of(problem(pid, 4, "first", 5000, false)), List.of()).get("cursor").asLong();

        // an older edit from a phone that was offline is ignored
        sync(token, c1, List.of(problem(pid, 2, "stale", 4000, false)), List.of());
        JsonNode all = sync(token, 0, List.of(), List.of());
        assertThat(all.get("problems").get(0).get("memo").asText()).isEqualTo("first");
        assertThat(all.get("problems").get(0).get("grade").asInt()).isEqualTo(4);

        // a newer delete wins and shows up for other phones
        long c2 = all.get("cursor").asLong();
        sync(token, c2, List.of(problem(pid, 4, "first", 9000, true)), List.of());
        JsonNode after = sync(token, c2, List.of(), List.of());
        assertThat(after.get("problems")).hasSize(1);
        assertThat(after.get("problems").get(0).get("deleted").asBoolean()).isTrue();
    }

    @Test
    void cannotTouchAnotherUsersRows() throws Exception {
        String alice = signup(uniqueName()), bob = signup(uniqueName());
        String pid = UUID.randomUUID().toString();
        sync(alice, 0, List.of(problem(pid, 4, "alice", 5000, false)), List.of());
        // bob tries to overwrite alice's problem id and attach an attempt to it
        JsonNode b = sync(bob, 0, List.of(problem(pid, 1, "bob", 99999, false)), List.of(attempt(UUID.randomUUID().toString(), pid, "FLASH", 99999)));
        assertThat(b.get("problems")).isEmpty();
        assertThat(b.get("attempts")).isEmpty();
        JsonNode a = sync(alice, 0, List.of(), List.of());
        assertThat(a.get("problems").get(0).get("memo").asText()).isEqualTo("alice");
        assertThat(a.get("attempts")).isEmpty();
    }

    @Test
    void rejectsInvalidRows() throws Exception {
        String token = signup(uniqueName());
        mvc.perform(post("/api/sync").header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("since", 0, "problems", List.of(), "attempts",
                        List.of(attempt(UUID.randomUUID().toString(), "p", "WINNING", 1))))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("결과 값이 올바르지 않아요."));
    }

    @Test
    void corsAllowsTheAndroidApp() throws Exception {
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options("/api/sync")
                .header("Origin", "https://localhost").header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "authorization,content-type"))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header().exists("Access-Control-Allow-Origin"));
    }
}
