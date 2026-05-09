import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApi, mockToast, mockAnimateNumber } = vi.hoisted(() => ({
  mockApi: {
    todos:       vi.fn(),
    todoCreate:  vi.fn().mockResolvedValue({}),
    todoUpdate:  vi.fn().mockResolvedValue({}),
    todoDelete:  vi.fn().mockResolvedValue({}),
  },
  mockToast:         vi.fn().mockReturnValue(() => {}),
  mockAnimateNumber: vi.fn(),
}));

vi.mock("../../src/frontend/api.js", () => ({ api: mockApi }));
vi.mock("../../src/frontend/components/util.js", () => ({
  $:             (sel: string) => document.querySelector(sel),
  escapeHtml:    (s: string) => s,
  todayKey:      () => "2026-05-09",
  timeAgo:       () => "just now",
  toast:         mockToast,
  animateNumber: mockAnimateNumber,
}));

import {
  loadTodos,
  addTodo,
  toggleTodo,
  deleteTodo,
  moveToToday,
  switchTab,
  bindTodoEvents,
  getTodos,
} from "../../src/frontend/components/todo.js";

function buildDom() {
  document.body.innerHTML = `
    <input id="todo-input" />
    <ul id="todo-list"></ul>
    <div id="todo-empty"></div>
    <div id="kpi-todos"></div>
    <div id="kpi-todos-detail"></div>
    <div class="tabs">
      <button class="tab active" data-tab="today">Today</button>
      <button class="tab" data-tab="backlog">Backlog</button>
      <button class="tab" data-tab="done">Done</button>
    </div>
  `;
}

const makeTodo = (overrides = {}) => ({
  id: "t-1", text: "Write tests", done: false,
  createdDate: "2026-05-09", createdAt: Date.now(), completedAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  buildDom();
  mockApi.todos.mockResolvedValue({ data: [] });
});

// ── loadTodos ─────────────────────────────────────────────────────────────────

describe("loadTodos", () => {
  it("loads todos from API and renders them", async () => {
    mockApi.todos.mockResolvedValue({ data: [makeTodo()] });
    await loadTodos();
    expect(getTodos()).toHaveLength(1);
  });

  it("does not crash when API rejects", async () => {
    mockApi.todos.mockRejectedValueOnce(new Error("down"));
    await expect(loadTodos()).resolves.toBeUndefined();
  });

  it("renders empty state when no todos", async () => {
    await loadTodos();
    expect(document.getElementById("todo-empty")!.style.display).toBe("block");
  });

  it("renders todo items when todos exist", async () => {
    mockApi.todos.mockResolvedValue({ data: [makeTodo()] });
    await loadTodos();
    expect(document.getElementById("todo-list")!.innerHTML).toContain("Write tests");
  });

  it("calls animateNumber with open todo count", async () => {
    mockApi.todos.mockResolvedValue({ data: [makeTodo(), makeTodo({ id: "t-2", done: true })] });
    await loadTodos();
    expect(mockAnimateNumber).toHaveBeenCalledWith(expect.anything(), 1);
  });
});

// ── addTodo ───────────────────────────────────────────────────────────────────

describe("addTodo", () => {
  it("adds todo from input value", async () => {
    (document.getElementById("todo-input") as HTMLInputElement).value = "New task";
    await addTodo();
    expect(getTodos()[0].text).toBe("New task");
    expect(mockApi.todoCreate).toHaveBeenCalled();
  });

  it("adds todo from explicit text argument", async () => {
    await addTodo("Explicit task");
    expect(getTodos().some(t => t.text === "Explicit task")).toBe(true);
  });

  it("does not add todo when text is empty", async () => {
    const before = getTodos().length;
    await addTodo("  ");
    expect(getTodos().length).toBe(before);
    expect(mockApi.todoCreate).not.toHaveBeenCalled();
  });

  it("clears the input after adding", async () => {
    const input = document.getElementById("todo-input") as HTMLInputElement;
    input.value = "Clear me";
    await addTodo();
    expect(input.value).toBe("");
  });

  it("calls toast on success", async () => {
    await addTodo("Toast test");
    expect(mockToast).toHaveBeenCalledWith("Added", "success");
  });

  it("calls toast with error when API rejects", async () => {
    mockApi.todoCreate.mockRejectedValueOnce(new Error("fail"));
    await addTodo("Fail task");
    expect(mockToast).toHaveBeenCalledWith("Saved locally only", "error");
  });
});

// ── toggleTodo ────────────────────────────────────────────────────────────────

describe("toggleTodo", () => {
  beforeEach(async () => {
    mockApi.todos.mockResolvedValue({ data: [makeTodo()] });
    await loadTodos();
  });

  it("marks todo as done and sets completedAt", async () => {
    const before = Date.now();
    await toggleTodo("t-1");
    const t = getTodos().find(x => x.id === "t-1")!;
    expect(t.done).toBe(true);
    expect(t.completedAt).toBeGreaterThanOrEqual(before);
  });

  it("marks done todo as undone and clears completedAt", async () => {
    await toggleTodo("t-1");
    await toggleTodo("t-1");
    expect(getTodos().find(x => x.id === "t-1")!.done).toBe(false);
    expect(getTodos().find(x => x.id === "t-1")!.completedAt).toBeNull();
  });

  it("calls api.todoUpdate", async () => {
    await toggleTodo("t-1");
    expect(mockApi.todoUpdate).toHaveBeenCalledWith("t-1", { done: true });
  });

  it("does nothing for unknown id", async () => {
    await toggleTodo("ghost");
    expect(mockApi.todoUpdate).not.toHaveBeenCalled();
  });
});

// ── deleteTodo ────────────────────────────────────────────────────────────────

describe("deleteTodo", () => {
  beforeEach(async () => {
    mockApi.todos.mockResolvedValue({ data: [makeTodo()] });
    await loadTodos();
  });

  it("removes todo from state", async () => {
    await deleteTodo("t-1");
    expect(getTodos().find(t => t.id === "t-1")).toBeUndefined();
  });

  it("calls toast with undo action", async () => {
    await deleteTodo("t-1");
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Write tests"),
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
    );
  });

  it("does nothing for unknown id", async () => {
    const before = getTodos().length;
    await deleteTodo("ghost");
    expect(getTodos().length).toBe(before);
  });
});

// ── moveToToday ───────────────────────────────────────────────────────────────

describe("moveToToday", () => {
  beforeEach(async () => {
    mockApi.todos.mockResolvedValue({ data: [makeTodo({ createdDate: "2026-04-01" })] });
    await loadTodos();
  });

  it("updates createdDate to today", async () => {
    await moveToToday("t-1");
    expect(getTodos().find(t => t.id === "t-1")!.createdDate).toBe("2026-05-09");
  });

  it("calls api.todoUpdate with new createdDate", async () => {
    await moveToToday("t-1");
    expect(mockApi.todoUpdate).toHaveBeenCalledWith("t-1", { createdDate: "2026-05-09" });
  });

  it("does nothing for unknown id", async () => {
    await moveToToday("ghost");
    expect(mockApi.todoUpdate).not.toHaveBeenCalled();
  });
});

// ── switchTab ─────────────────────────────────────────────────────────────────

describe("switchTab", () => {
  beforeEach(async () => {
    mockApi.todos.mockResolvedValue({ data: [
      makeTodo({ id: "t-today", createdDate: "2026-05-09", done: false }),
      makeTodo({ id: "t-back",  createdDate: "2026-04-01", done: false }),
      makeTodo({ id: "t-done",  done: true, completedAt: Date.now() }),
    ]});
    await loadTodos();
  });

  it("switches to backlog and renders backlog todos", () => {
    switchTab("backlog");
    expect(document.getElementById("todo-list")!.innerHTML).toContain("t-back");
  });

  it("switches to done and renders completed todos", () => {
    switchTab("done");
    expect(document.getElementById("todo-list")!.innerHTML).toContain("t-done");
  });

  it("activates correct tab button", () => {
    switchTab("backlog");
    const backlogBtn = document.querySelector<HTMLElement>('[data-tab="backlog"]')!;
    expect(backlogBtn.classList.contains("active")).toBe(true);
  });

  it("shows empty state for empty backlog", async () => {
    mockApi.todos.mockResolvedValue({ data: [makeTodo()] });
    await loadTodos();
    switchTab("backlog");
    expect(document.getElementById("todo-empty")!.style.display).toBe("block");
  });

  it("shows 'Nothing completed yet' empty state for empty done tab", async () => {
    mockApi.todos.mockResolvedValue({ data: [makeTodo()] }); // no done todos
    await loadTodos();
    switchTab("done");
    const empty = document.getElementById("todo-empty")!;
    expect(empty.style.display).toBe("block");
    expect(empty.innerHTML).toContain("Nothing completed yet");
  });
});

// ── bindTodoEvents ────────────────────────────────────────────────────────────

describe("bindTodoEvents", () => {
  it("pressing Enter on input calls addTodo", async () => {
    bindTodoEvents();
    const input = document.getElementById("todo-input") as HTMLInputElement;
    input.value = "From keyboard";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(getTodos().some(t => t.text === "From keyboard")).toBe(true);
  });

  it("clicking toggle action dispatches toggleTodo", async () => {
    switchTab("today");
    mockApi.todos.mockResolvedValue({ data: [makeTodo()] });
    await loadTodos();
    bindTodoEvents();
    const checkbox = document.querySelector<HTMLElement>('[data-todo-action="toggle"]')!;
    checkbox.click();
    await new Promise(r => setTimeout(r, 0));
    expect(mockApi.todoUpdate).toHaveBeenCalled();
  });

  it("clicking delete action dispatches deleteTodo", async () => {
    switchTab("today");
    mockApi.todos.mockResolvedValue({ data: [makeTodo()] });
    await loadTodos();
    bindTodoEvents();
    const btn = document.querySelector<HTMLElement>('[data-todo-action="delete"]')!;
    btn.click();
    await new Promise(r => setTimeout(r, 0));
    expect(getTodos().find(t => t.id === "t-1")).toBeUndefined();
  });

  it("clicking move action dispatches moveToToday", async () => {
    // Switch to backlog first so the "move" button is rendered
    mockApi.todos.mockResolvedValue({ data: [makeTodo({ createdDate: "2026-04-01" })] });
    await loadTodos();
    switchTab("backlog");
    bindTodoEvents();
    const btn = document.querySelector<HTMLElement>('[data-todo-action="move"]')!;
    btn.click();
    await new Promise(r => setTimeout(r, 0));
    expect(mockApi.todoUpdate).toHaveBeenCalledWith("t-1", { createdDate: "2026-05-09" });
  });
});

describe("deleteTodo undo callback", () => {
  beforeEach(async () => {
    mockApi.todos.mockResolvedValue({ data: [makeTodo()] });
    await loadTodos();
  });

  it("restores todo when undo is triggered before server deletion", async () => {
    vi.useFakeTimers();
    mockToast.mockReturnValue(() => {});
    await deleteTodo("t-1");

    // Extract and call the undo onClick handler
    const toastArgs = mockToast.mock.calls[0];
    const actionArg = toastArgs[1] as any;
    actionArg.action.onClick();

    expect(getTodos().find(t => t.id === "t-1")).toBeDefined();
    vi.useRealTimers();
  });

  it("commit() fires api.todoDelete after 5 s timer", async () => {
    vi.useFakeTimers();
    mockToast.mockReturnValue(() => {});
    await deleteTodo("t-1");

    // Advance time past the 5 s commit window
    vi.advanceTimersByTime(6000);
    await Promise.resolve(); // flush microtasks
    expect(mockApi.todoDelete).toHaveBeenCalledWith("t-1");
    vi.useRealTimers();
  });

  it("restores via todoCreate when undo is called after server deletion", async () => {
    vi.useFakeTimers();
    mockToast.mockReturnValue(() => {});
    await deleteTodo("t-1");

    // Fire the commit timer so serverDeleted becomes true
    vi.advanceTimersByTime(6000);
    await Promise.resolve();

    // Now call undo — should recreate via todoCreate
    const actionArg = (mockToast.mock.calls[0][1] as any);
    actionArg.action.onClick();
    await Promise.resolve();

    expect(mockApi.todoCreate).toHaveBeenCalled();
    expect(getTodos().find(t => t.id === "t-1")).toBeDefined();
    vi.useRealTimers();
  });
});
