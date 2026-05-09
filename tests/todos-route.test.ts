import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import express from "express";
import request from "supertest";

let testDb: InstanceType<typeof Database>;

vi.mock("../src/server/db.js", () => ({ getDb: () => testDb }));

import { todosRouter } from "../src/server/routes/todos.js";

const app = express();
app.use(express.json());
app.use(todosRouter);

function buildDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
      created_date TEXT NOT NULL, created_at INTEGER NOT NULL,
      completed_at INTEGER, priority TEXT, due_date TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done);
  `);
  return db;
}

beforeEach(() => { testDb = buildDb(); });

const validTodo = {
  id: "todo-1", text: "Write tests", done: false,
  createdDate: "2026-05-09", createdAt: 1715000000,
};

describe("GET /", () => {
  it("returns empty array when no todos exist", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("returns todos ordered by done ASC, created_at DESC", async () => {
    await request(app).post("/").send({ ...validTodo, id: "t1", text: "A", createdAt: 1000 });
    await request(app).post("/").send({ ...validTodo, id: "t2", text: "B", createdAt: 2000 });
    await request(app).patch("/t1").send({ done: true });
    const res = await request(app).get("/");
    expect(res.body.data[0].id).toBe("t2"); // undone, higher createdAt first
    expect(res.body.data[1].id).toBe("t1"); // done last
  });

  it("maps DB columns to camelCase fields", async () => {
    await request(app).post("/").send({ ...validTodo, priority: "high", dueDate: "2026-06-01" });
    const res = await request(app).get("/");
    const t = res.body.data[0];
    expect(t.createdDate).toBe("2026-05-09");
    expect(t.priority).toBe("high");
    expect(t.dueDate).toBe("2026-06-01");
    expect(t.completedAt).toBeNull();
  });
});

describe("POST /", () => {
  it("creates a todo and returns its id", async () => {
    const res = await request(app).post("/").send(validTodo);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("todo-1");
  });

  it("rejects missing required fields", async () => {
    const res = await request(app).post("/").send({ id: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid createdDate format", async () => {
    const res = await request(app).post("/").send({ ...validTodo, createdDate: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid priority value", async () => {
    const res = await request(app).post("/").send({ ...validTodo, priority: "urgent" });
    expect(res.status).toBe(400);
  });

  it("accepts null priority and dueDate", async () => {
    const res = await request(app).post("/").send({ ...validTodo, priority: null, dueDate: null });
    expect(res.status).toBe(200);
  });

  it("accepts valid priority values: low, medium, high", async () => {
    for (const p of ["low", "medium", "high"] as const) {
      const res = await request(app).post("/").send({ ...validTodo, id: `t-${p}`, priority: p });
      expect(res.status).toBe(200);
    }
  });

  it("defaults createdAt to now when not provided", async () => {
    const before = Date.now();
    await request(app).post("/").send({ id: "t-auto", text: "A", createdDate: "2026-05-09" });
    const res = await request(app).get("/");
    const t = res.body.data.find((x: any) => x.id === "t-auto");
    expect(t.createdAt).toBeGreaterThanOrEqual(before);
  });
});

describe("PATCH /:id", () => {
  beforeEach(async () => {
    await request(app).post("/").send(validTodo);
  });

  it("updates the text field", async () => {
    await request(app).patch("/todo-1").send({ text: "Updated" });
    const res = await request(app).get("/");
    expect(res.body.data[0].text).toBe("Updated");
  });

  it("marks as done and sets completedAt", async () => {
    const before = Date.now();
    await request(app).patch("/todo-1").send({ done: true });
    const res = await request(app).get("/");
    expect(res.body.data[0].done).toBe(true);
    expect(res.body.data[0].completedAt).toBeGreaterThanOrEqual(before);
  });

  it("marks as undone and clears completedAt", async () => {
    await request(app).patch("/todo-1").send({ done: true });
    await request(app).patch("/todo-1").send({ done: false });
    const res = await request(app).get("/");
    expect(res.body.data[0].done).toBe(false);
    expect(res.body.data[0].completedAt).toBeNull();
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app).patch("/no-such-id").send({ text: "x" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid body", async () => {
    const res = await request(app).patch("/todo-1").send({ priority: "mega" });
    expect(res.status).toBe(400);
  });

  it("returns the id in the response", async () => {
    const res = await request(app).patch("/todo-1").send({ text: "New" });
    expect(res.body.data.id).toBe("todo-1");
  });

  it("updates priority to null", async () => {
    await request(app).patch("/todo-1").send({ priority: null });
    const res = await request(app).get("/");
    expect(res.body.data[0].priority).toBeNull();
  });
});

describe("DELETE /:id", () => {
  beforeEach(async () => {
    await request(app).post("/").send(validTodo);
  });

  it("deletes an existing todo and returns its id", async () => {
    const res = await request(app).delete("/todo-1");
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("todo-1");
    const list = await request(app).get("/");
    expect(list.body.data).toHaveLength(0);
  });

  it("returns 200 even if id does not exist (SQLite DELETE is idempotent)", async () => {
    const res = await request(app).delete("/ghost-id");
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("ghost-id");
  });
});
