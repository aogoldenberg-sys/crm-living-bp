import { useState, useEffect } from "react";
import {
  collection, query, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc,
  getDocs, orderBy, arrayUnion,
} from "firebase/firestore";
import { db } from "../../firebase";

interface Comment { author: string; text: string; ts: string }

interface Task {
  id: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "done";
  priority: "normal" | "high";
  assignedTo: string;
  createdBy: string;
  createdAt: string;
  dueDate?: string;
  comments?: Comment[];
}

interface Props { businessId: string; currentUser: string; roleId: string }

const COLS: { id: Task["status"]; label: string; color: string }[] = [
  { id: "open",        label: "Открытые",  color: "#8B7355" },
  { id: "in_progress", label: "В работе",  color: "#5C7A3E" },
  { id: "done",        label: "Готово",    color: "#3A6B8A" },
];

const NEXT: Record<Task["status"], Task["status"] | null> = {
  open: "in_progress", in_progress: "done", done: null,
};
const PREV: Record<Task["status"], Task["status"] | null> = {
  open: null, in_progress: "open", done: "in_progress",
};

const S: Record<string, React.CSSProperties> = {
  input: {
    width: "100%", padding: "9px 12px", borderRadius: 9,
    border: "1px solid rgba(200,154,52,.35)", background: "rgba(255,255,255,.85)",
    fontSize: 14, color: "#1A1814", outline: "none", boxSizing: "border-box",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  btn: {
    border: "none", borderRadius: 8, padding: "6px 14px",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
    fontFamily: "Inter, system-ui, sans-serif",
    transition: "opacity .15s",
  },
};

export function TasksView({ businessId, currentUser, roleId }: Props) {
  const [tasks,     setTasks]     = useState<Task[]>([]);
  const [employees, setEmployees] = useState<{ email: string; name: string }[]>([]);
  const [form, setForm] = useState({
    title: "", assignedTo: currentUser, priority: "normal" as "normal" | "high",
    dueDate: "", description: "",
  });
  const [saving, setSaving]   = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const isDirector = roleId === "director";

  // Список сотрудников для выбора исполнителя
  useEffect(() => {
    getDocs(collection(db, `tenants/${businessId}/emailRoles`)).then(snap => {
      const list = snap.docs
        .filter(d => d.data().active !== false)
        .map(d => ({ email: d.id, name: (d.data().displayName as string) || d.id }))
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
      setEmployees(list);
      // По умолчанию выбираем первого сотрудника, отличного от себя
      const other = list.find(e => e.email !== currentUser);
      if (other) setForm(f => ({ ...f, assignedTo: other.email }));
    }).catch(() => {});
  }, [businessId, currentUser]);

  // Подписка на задачи
  useEffect(() => {
    const toTask = (d: import("firebase/firestore").DocumentSnapshot) =>
      ({ id: d.id, ...d.data() } as Task);

    if (isDirector) {
      const q = query(collection(db, `tenants/${businessId}/tasks`), orderBy("createdAt", "desc"));
      return onSnapshot(q, snap => setTasks(snap.docs.map(toTask)), () => {});
    }

    let assigned: Task[] = [], created: Task[] = [];
    const merge = () => {
      const map = new Map([...assigned, ...created].map(t => [t.id, t]));
      setTasks(Array.from(map.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    };

    // Без orderBy — составной индекс не нужен; сортируем на клиенте в merge()
    const qA = query(collection(db, `tenants/${businessId}/tasks`),
      where("assignedTo", "==", currentUser));
    const qC = query(collection(db, `tenants/${businessId}/tasks`),
      where("createdBy",  "==", currentUser));

    const uA = onSnapshot(qA, s => { assigned = s.docs.map(toTask); merge(); }, () => {});
    const uC = onSnapshot(qC, s => { created  = s.docs.map(toTask); merge(); }, () => {});
    return () => { uA(); uC(); };
  }, [businessId, currentUser, isDirector]);

  async function createTask() {
    if (!form.title.trim()) return;
    setSaving(true);
    await addDoc(collection(db, `tenants/${businessId}/tasks`), {
      title:       form.title.trim(),
      description: form.description.trim() || null,
      status:      "open",
      priority:    form.priority,
      assignedTo:  form.assignedTo,
      createdBy:   currentUser,
      createdAt:   new Date().toISOString(),
      dueDate:     form.dueDate || null,
      comments:    [],
    });
    setForm({ title: "", assignedTo: currentUser, priority: "normal", dueDate: "", description: "" });
    setSaving(false);
  }

  async function moveTask(t: Task, dir: "prev" | "next") {
    const ns = dir === "next" ? NEXT[t.status] : PREV[t.status];
    if (ns) await updateDoc(doc(db, `tenants/${businessId}/tasks`, t.id), { status: ns });
  }

  async function toggleDone(t: Task) {
    const ns: Task["status"] = t.status === "done" ? "open" : "done";
    await updateDoc(doc(db, `tenants/${businessId}/tasks`, t.id), { status: ns });
  }

  async function updateDue(t: Task, dueDate: string) {
    await updateDoc(doc(db, `tenants/${businessId}/tasks`, t.id), { dueDate: dueDate || null });
  }

  async function addComment(t: Task) {
    const text = (commentText[t.id] ?? "").trim();
    if (!text) return;
    const c: Comment = { author: currentUser, text, ts: new Date().toISOString() };
    await updateDoc(doc(db, `tenants/${businessId}/tasks`, t.id), { comments: arrayUnion(c) });
    setCommentText(p => ({ ...p, [t.id]: "" }));
  }

  async function removeTask(t: Task) {
    if (!confirm(`Удалить «${t.title}»?`)) return;
    await deleteDoc(doc(db, `tenants/${businessId}/tasks`, t.id));
  }

  const name = (email: string) => employees.find(e => e.email === email)?.name ?? email;
  const canDel = (t: Task) => isDirector || t.createdBy === currentUser;
  const isOverdue = (t: Task) =>
    !!(t.dueDate && t.status !== "done" && t.dueDate < new Date().toISOString().slice(0, 10));

  return (
    <div style={{ padding: "28px 28px 40px", minHeight: "100%", boxSizing: "border-box" }}>
      <h2 style={{ margin: "0 0 24px", fontSize: 22, fontWeight: 700, color: "#1A1814", fontFamily: "'Cormorant Garamond', serif", letterSpacing: ".02em" }}>
        Задачи
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, alignItems: "start" }}>
        {COLS.map(col => {
          const colTasks = tasks.filter(t => t.status === col.id);
          return (
            <div key={col.id} style={{ background: "rgba(255,255,255,.65)", backdropFilter: "blur(8px)", borderRadius: 18, padding: 16, border: "1px solid rgba(200,154,52,.18)", minHeight: 220 }}>
              {/* Заголовок колонки */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid rgba(200,154,52,.15)" }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: col.color, textTransform: "uppercase", letterSpacing: ".06em" }}>{col.label}</span>
                <span style={{ background: "rgba(200,154,52,.15)", color: "#7A5C14", borderRadius: 10, padding: "1px 8px", fontSize: 12, fontWeight: 600 }}>{colTasks.length}</span>
              </div>

              {/* Карточки задач */}
              {colTasks.map(t => {
                const open = expanded[t.id];
                const overdue = isOverdue(t);
                return (
                  <div key={t.id} style={{
                    background: "#fff", borderRadius: 13, padding: "12px 14px", marginBottom: 12,
                    boxShadow: "0 2px 12px rgba(0,0,0,.06)",
                    borderLeft: `3px solid ${t.priority === "high" ? "#C62828" : "rgba(200,154,52,.4)"}`,
                    transition: "box-shadow .15s",
                  }}>
                    {/* Строка: чекбокс + название + приоритет */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <input type="checkbox" checked={t.status === "done"} onChange={() => toggleDone(t)}
                        style={{ marginTop: 3, width: 16, height: 16, cursor: "pointer", accentColor: "#5C7A3E", flexShrink: 0 }} />
                      <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: "#1A1814", lineHeight: 1.4, textDecoration: t.status === "done" ? "line-through" : "none", opacity: t.status === "done" ? .55 : 1 }}>
                        {t.title}
                      </span>
                      {t.priority === "high" && (
                        <span style={{ background: "#FFEBEE", color: "#C62828", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap", flexShrink: 0 }}>СРОЧНО</span>
                      )}
                    </div>

                    {/* Описание */}
                    {t.description && (
                      <div style={{ fontSize: 12, color: "#5A4E3C", marginTop: 6, lineHeight: 1.5, paddingLeft: 24 }}>{t.description}</div>
                    )}

                    {/* Исполнитель / автор */}
                    <div style={{ fontSize: 12, color: "#8B7355", marginTop: 8, paddingLeft: 24, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span>→ <strong style={{ color: "#5A4E3C" }}>{name(t.assignedTo)}</strong></span>
                      {t.createdBy !== t.assignedTo && <span style={{ color: "#B0A090" }}>от {name(t.createdBy)}</span>}
                    </div>

                    {/* Срок (редактируемый) */}
                    <div style={{ paddingLeft: 24, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: overdue ? "#C62828" : "#8B7355", fontWeight: overdue ? 700 : 400 }}>
                        {overdue ? "⚠ срок:" : "срок:"}
                      </span>
                      <input
                        type="date"
                        defaultValue={t.dueDate ?? ""}
                        onBlur={e => { if (e.target.value !== (t.dueDate ?? "")) updateDue(t, e.target.value); }}
                        style={{ border: "none", background: "transparent", fontSize: 12, color: overdue ? "#C62828" : "#5A4E3C", cursor: "pointer", fontFamily: "Inter, sans-serif", padding: 0, outline: "none", fontWeight: overdue ? 700 : 400 }}
                      />
                    </div>

                    {/* Кнопки управления */}
                    <div style={{ display: "flex", gap: 5, marginTop: 10, paddingLeft: 24 }}>
                      {PREV[t.status] && (
                        <button onClick={() => moveTask(t, "prev")} style={{ ...S.btn, background: "rgba(200,154,52,.12)", color: "#7A5C14", padding: "4px 10px", fontSize: 12 }}>← Назад</button>
                      )}
                      {NEXT[t.status] && (
                        <button onClick={() => moveTask(t, "next")} style={{ ...S.btn, background: t.status === "in_progress" ? "#E8F5E9" : "rgba(200,154,52,.12)", color: t.status === "in_progress" ? "#2E7D32" : "#7A5C14", padding: "4px 10px", fontSize: 12 }}>Вперёд →</button>
                      )}
                      <button onClick={() => setExpanded(p => ({ ...p, [t.id]: !p[t.id] }))}
                        style={{ ...S.btn, background: "rgba(200,154,52,.10)", color: "#8B7355", padding: "4px 10px", fontSize: 12, marginLeft: "auto" }}>
                        💬 {(t.comments?.length ?? 0) > 0 ? t.comments!.length : ""}
                      </button>
                      {canDel(t) && (
                        <button onClick={() => removeTask(t)} style={{ ...S.btn, background: "#FFEBEE", color: "#C62828", padding: "4px 8px", fontSize: 13 }}>✕</button>
                      )}
                    </div>

                    {/* Раскрываемая панель комментариев */}
                    {open && (
                      <div style={{ marginTop: 10, paddingLeft: 24, borderTop: "1px solid rgba(200,154,52,.15)", paddingTop: 10 }}>
                        {(t.comments ?? []).length === 0 && (
                          <div style={{ fontSize: 12, color: "#B0A090", marginBottom: 8 }}>Комментариев пока нет</div>
                        )}
                        {(t.comments ?? []).map((c, i) => (
                          <div key={i} style={{ marginBottom: 8 }}>
                            <span style={{ fontSize: 11, color: "#8B7355", fontWeight: 600 }}>{name(c.author)}</span>
                            <span style={{ fontSize: 11, color: "#B0A090", marginLeft: 6 }}>{c.ts.slice(0, 10)}</span>
                            <div style={{ fontSize: 13, color: "#2A2520", marginTop: 2, lineHeight: 1.5 }}>{c.text}</div>
                          </div>
                        ))}
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <input
                            placeholder="Комментарий или промежуточный результат..."
                            value={commentText[t.id] ?? ""}
                            onChange={e => setCommentText(p => ({ ...p, [t.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void addComment(t); } }}
                            style={{ ...S.input, flex: 1, fontSize: 13, padding: "7px 10px" }}
                          />
                          <button onClick={() => addComment(t)} style={{ ...S.btn, background: "rgba(200,154,52,.22)", color: "#7A5C14", padding: "7px 12px" }}>↵</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Форма создания (только в колонке "Открытые") */}
              {col.id === "open" && (
                <div style={{ background: "rgba(200,154,52,.06)", borderRadius: 12, padding: "12px 14px", border: "1px dashed rgba(200,154,52,.3)", marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#8B7355", marginBottom: 10, letterSpacing: ".04em" }}>+ НОВАЯ ЗАДАЧА</div>

                  <input placeholder="Название *" value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && void createTask()}
                    style={{ ...S.input, marginBottom: 8 }} />

                  <label style={{ display: "block", fontSize: 11, color: "#8B7355", marginBottom: 4, fontWeight: 500 }}>Исполнитель</label>
                  <select value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
                    style={{ ...S.input, marginBottom: 8 }}>
                    {employees.length === 0
                      ? <option value={currentUser}>{currentUser}</option>
                      : employees.map(e => <option key={e.email} value={e.email}>{e.name}</option>)
                    }
                  </select>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "#8B7355", marginBottom: 4, fontWeight: 500 }}>Приоритет</label>
                      <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as "normal" | "high" }))}
                        style={{ ...S.input }}>
                        <option value="normal">Обычный</option>
                        <option value="high">Срочный</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "#8B7355", marginBottom: 4, fontWeight: 500 }}>Срок</label>
                      <input type="date" value={form.dueDate}
                        onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                        style={{ ...S.input }} />
                    </div>
                  </div>

                  <textarea placeholder="Описание (необязательно)" value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={2}
                    style={{ ...S.input, marginBottom: 10, resize: "vertical", minHeight: 54 }} />

                  <button onClick={createTask} disabled={saving || !form.title.trim()}
                    style={{ ...S.btn, width: "100%", padding: "10px", fontSize: 14,
                      background: "linear-gradient(135deg,#8A6415 0%,#B98D2A 35%,#E4C260 60%,#A67E1E 100%)",
                      color: "#3A2800", opacity: saving || !form.title.trim() ? .5 : 1,
                      boxShadow: "0 2px 8px rgba(180,130,20,.3)", letterSpacing: ".03em" }}>
                    {saving ? "Создаю..." : "Создать задачу"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
