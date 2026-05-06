import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db.js";

export const todosRouter = Router();

type TodoRow = {
  id: string; text: string; done: number; created_date: string;
  created_at: number; completed_at: number | null;
  priority: string | null; due_date: string | null;
};

function rowToTodo(r: TodoRow) {
  return {
    id: r.id,
    text: r.text,
    done: !!r.done,
    createdDate: r.created_date,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    priority: r.priority,
    dueDate: r.due_date,
  };
}

todosRouter.get("/", (_req, res) => {
  const rows = getDb().prepare(`SELECT * FROM todos ORDER BY done ASC, created_at DESC`).all() as TodoRow[];
  res.json({ data: rows.map(rowToTodo) });
});

const NewTodo = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  done: z.boolean().optional().default(false),
  createdDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createdAt: z.number().int().optional(),
  priority: z.enum(["low", "medium", "high"]).nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

todosRouter.post("/", (req, res) => {
  const parsed = NewTodo.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const t = parsed.data;
  getDb().prepare(`
    INSERT OR REPLACE INTO todos (id, text, done, created_date, created_at, completed_at, priority, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(t.id, t.text, t.done ? 1 : 0, t.createdDate, t.createdAt ?? Date.now(), null, t.priority ?? null, t.dueDate ?? null);
  res.json({ data: { id: t.id } });
});

const PatchTodo = z.object({
  text: z.string().min(1).optional(),
  done: z.boolean().optional(),
  createdDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(["low", "medium", "high"]).nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

todosRouter.patch("/:id", (req, res) => {
  const parsed = PatchTodo.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const id = req.params.id;
  const cur = getDb().prepare(`SELECT * FROM todos WHERE id=?`).get(id) as TodoRow | undefined;
  if (!cur) return res.status(404).json({ error: "not found" });
  const p = parsed.data;
  const text = p.text ?? cur.text;
  const done = p.done === undefined ? cur.done : (p.done ? 1 : 0);
  const completedAt = p.done === true ? Date.now() : (p.done === false ? null : cur.completed_at);
  const createdDate = p.createdDate ?? cur.created_date;
  const priority = p.priority === undefined ? cur.priority : p.priority;
  const dueDate = p.dueDate === undefined ? cur.due_date : p.dueDate;
  getDb().prepare(`
    UPDATE todos SET text=?, done=?, created_date=?, completed_at=?, priority=?, due_date=? WHERE id=?
  `).run(text, done, createdDate, completedAt, priority, dueDate, id);
  res.json({ data: { id } });
});

todosRouter.delete("/:id", (req, res) => {
  getDb().prepare(`DELETE FROM todos WHERE id=?`).run(req.params.id);
  res.json({ data: { id: req.params.id } });
});
