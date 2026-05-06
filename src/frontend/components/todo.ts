import { api, type Todo } from "../api.js";
import { $, escapeHtml, todayKey, timeAgo, toast, animateNumber } from "./util.js";

type Tab = "today" | "backlog" | "done";

const state = { todos: [] as Todo[], tab: "today" as Tab };

export async function loadTodos() {
  try {
    const { data } = await api.todos();
    state.todos = data;
  } catch { /* server might be down briefly */ }
  render();
  updateKpi();
}

export async function addTodo(text?: string) {
  const input = $<HTMLInputElement>("#todo-input");
  const t = (text ?? input?.value ?? "").trim();
  if (!t) return;
  const todo: Todo = {
    id: "t-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    text: t, done: false, createdDate: todayKey(), createdAt: Date.now(), completedAt: null,
  };
  state.todos.unshift(todo);
  if (input) input.value = "";
  render(); updateKpi();
  try { await api.todoCreate(todo); toast("Added", "success"); } catch { toast("Saved locally only", "error"); }
}

export async function toggleTodo(id: string) {
  const t = state.todos.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.completedAt = t.done ? Date.now() : null;
  render(); updateKpi();
  try { await api.todoUpdate(id, { done: t.done }); } catch {}
}

export async function deleteTodo(id: string) {
  const idx = state.todos.findIndex(t => t.id === id);
  if (idx < 0) return;
  const removed = state.todos[idx];
  state.todos.splice(idx, 1);

  // Animate the row out before re-rendering, if visible
  const row = document.querySelector<HTMLElement>(`.todo-item [data-id="${id}"]`)?.closest<HTMLElement>(".todo-item");
  if (row) {
    row.classList.add("removing");
    setTimeout(() => { render(); updateKpi(); }, 220);
  } else {
    render(); updateKpi();
  }

  // Optimistic delete with undo window
  let serverDeleted = false;
  const commit = () => {
    if (serverDeleted) return;
    serverDeleted = true;
    api.todoDelete(id).catch(() => {});
  };
  const t = window.setTimeout(commit, 5000);

  toast(`Deleted “${removed.text.slice(0, 40)}${removed.text.length > 40 ? "…" : ""}”`, {
    type: "info",
    duration: 5000,
    action: {
      label: "Undo",
      onClick: () => {
        clearTimeout(t);
        if (serverDeleted) {
          // Already gone server-side — recreate it.
          state.todos.splice(idx, 0, removed);
          api.todoCreate(removed).catch(() => {});
        } else {
          state.todos.splice(idx, 0, removed);
        }
        render(); updateKpi();
        toast("Restored", "success");
      },
    },
  });
}

export async function moveToToday(id: string) {
  const t = state.todos.find(x => x.id === id);
  if (!t) return;
  t.createdDate = todayKey();
  render();
  toast("Moved to today", "success");
  try { await api.todoUpdate(id, { createdDate: t.createdDate }); } catch {}
}

export function switchTab(tab: Tab) {
  state.tab = tab;
  document.querySelectorAll<HTMLElement>('.tabs .tab[data-tab]').forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab));
  render();
}

function render() {
  const list = $("#todo-list")!;
  const empty = $("#todo-empty")!;
  const today = todayKey();
  let visible: Todo[];
  if (state.tab === "today") visible = state.todos.filter(t => !t.done && t.createdDate === today);
  else if (state.tab === "backlog") visible = state.todos.filter(t => !t.done && t.createdDate !== today);
  else visible = state.todos.filter(t => t.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  if (!visible.length) {
    list.innerHTML = "";
    empty.style.display = "block";
    empty.innerHTML = state.tab === "today"
      ? `<span class="emoji">📥</span>
         <div class="empty-title">Empty for today</div>
         <div>Add a task above, or press <kbd>N</kbd> to focus the input.</div>`
      : state.tab === "backlog"
        ? `<span class="emoji">🎯</span>
           <div class="empty-title">Backlog clear</div>
           <div>Try setting a 1-week goal.</div>`
        : `<span class="emoji">🌱</span>
           <div class="empty-title">Nothing completed yet</div>
           <div>Cross things off and they'll show up here.</div>`;
    return;
  }
  empty.style.display = "none";
  list.innerHTML = visible.map(t => {
    const meta = state.tab === "done"
      ? `done ${timeAgo(t.completedAt)}`
      : t.createdDate === today ? "today" : `from ${t.createdDate}`;
    const moveBtn = state.tab === "backlog"
      ? `<button title="Move to today" data-todo-action="move" data-id="${t.id}">↑</button>` : "";
    return `
      <li class="todo-item ${t.done ? "done" : ""}">
        <input type="checkbox" ${t.done ? "checked" : ""} data-todo-action="toggle" data-id="${t.id}">
        <div>
          <div class="todo-text">${escapeHtml(t.text)}</div>
          <div class="todo-meta">${escapeHtml(meta)}</div>
        </div>
        <div class="todo-actions">
          ${moveBtn}
          <button title="Delete" data-todo-action="delete" data-id="${t.id}">✕</button>
        </div>
      </li>`;
  }).join("");
}

function updateKpi() {
  const open = state.todos.filter(t => !t.done).length;
  const today = state.todos.filter(t => !t.done && t.createdDate === todayKey()).length;
  animateNumber($("#kpi-todos"), open);
  const d = $("#kpi-todos-detail"); if (d) d.textContent = `${today} for today · ${open - today} in backlog`;
}

export function bindTodoEvents() {
  $("#todo-list")!.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-todo-action]");
    if (!t) return;
    const id = t.dataset.id!;
    const action = t.dataset.todoAction;
    if (action === "toggle") toggleTodo(id);
    else if (action === "delete") deleteTodo(id);
    else if (action === "move") moveToToday(id);
  });

  document.querySelectorAll<HTMLElement>('.tabs .tab[data-tab]').forEach(b => {
    b.addEventListener("click", () => switchTab(b.dataset.tab as Tab));
  });

  $("#todo-input")?.addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key === "Enter") addTodo();
  });
}

export function getTodos() { return state.todos; }
