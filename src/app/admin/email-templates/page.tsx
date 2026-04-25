"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SessionKeepAlive from "@/components/auth/SessionKeepAlive";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TiptapLink from "@tiptap/extension-link";

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  created_at: string;
}

function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  const btn = (active: boolean, onClick: () => void, label: string, children: React.ReactNode) => (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`px-2 py-1 rounded text-sm font-medium transition ${
        active ? "bg-slate-700 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-3 py-2 bg-slate-50 rounded-t-lg">
      {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "Bold", <strong>B</strong>)}
      {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "Italic", <em>I</em>)}
      {btn(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "Underline", <u>U</u>)}
      <div className="w-px h-4 bg-slate-200 mx-1" />
      {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "Bullet list", "• List")}
      {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "Ordered list", "1. List")}
    </div>
  );
}

export default function AdminEmailTemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Edit modal state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const bodyEditor = useEditor({
    extensions: [StarterKit, Underline, TiptapLink.configure({ openOnClick: false })],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-[180px] px-4 py-3 focus:outline-none text-slate-800",
      },
    },
  });

  const editBodyEditor = useEditor({
    extensions: [StarterKit, Underline, TiptapLink.configure({ openOnClick: false })],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-[180px] px-4 py-3 focus:outline-none text-slate-800",
      },
    },
  });

  useEffect(() => {
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/email-templates");
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setTemplates(data.templates || []);
      }
    } catch {
      setError("Failed to load templates.");
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim() || !bodyEditor) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/email-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          subject: newSubject.trim(),
          body: bodyEditor.getHTML(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || "Failed to save template.");
        return;
      }
      setTemplates((prev) => [...prev, data.template]);
      setShowAddModal(false);
      setNewName("");
      setNewSubject("");
      bodyEditor.commands.setContent("");
    } catch {
      setSaveError("An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (tpl: EmailTemplate) => {
    setEditingId(tpl.id);
    setEditName(tpl.name);
    setEditSubject(tpl.subject);
    editBodyEditor?.commands.setContent(tpl.body || "");
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim() || !editBodyEditor) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/email-templates/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          subject: editSubject.trim(),
          body: editBodyEditor.getHTML(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || "Failed to update template.");
        return;
      }
      setTemplates((prev) =>
        prev.map((t) => (t.id === editingId ? { ...t, ...data.template } : t))
      );
      setEditingId(null);
      setEditName("");
      setEditSubject("");
      editBodyEditor.commands.setContent("");
    } catch {
      setEditError("An unexpected error occurred.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/email-templates/${id}`, { method: "DELETE" });
      if (res.ok) {
        setTemplates((prev) => prev.filter((t) => t.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <SessionKeepAlive redirectTo="/admin/login" />

      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/dashboard"
            className="text-sm text-slate-500 hover:text-slate-700 transition"
          >
            ← Admin Dashboard
          </Link>
          <span className="text-slate-300">/</span>
          <h1 className="text-base font-semibold text-slate-800">Email Templates</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Global email templates available to all physicians.
        </p>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">

        {/* Add button */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 text-sm font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-700 transition"
          >
            + New Template
          </button>
        </div>

        {/* Loading / error */}
        {loading && <p className="text-sm text-slate-500">Loading templates…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Templates list */}
        {!loading && templates.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center text-sm text-slate-400">
            No global email templates yet. Create one to make it available to all physicians.
          </div>
        )}

        {templates.map((tpl) => (
          <div key={tpl.id} className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between p-4">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === tpl.id ? null : tpl.id)}
                className="text-left flex-1"
              >
                <div className="text-sm font-semibold text-slate-800">{tpl.name}</div>
                {tpl.subject && (
                  <div className="text-xs text-slate-500 mt-0.5">Subject: {tpl.subject}</div>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleEdit(tpl)}
                className="ml-4 text-xs text-blue-500 hover:text-blue-700 transition"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(tpl.id)}
                disabled={deletingId === tpl.id}
                className="ml-3 text-xs text-red-400 hover:text-red-600 disabled:opacity-40 transition"
              >
                {deletingId === tpl.id ? "Deleting…" : "Delete"}
              </button>
            </div>
            {expandedId === tpl.id && (
              <div className="border-t border-slate-100 px-4 py-3">
                <div
                  className="prose prose-sm max-w-none text-slate-700"
                  dangerouslySetInnerHTML={{ __html: tpl.body }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-800">New Global Email Template</h2>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Template name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Appointment Reminder"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Default subject</label>
              <input
                type="text"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                placeholder="e.g. Your upcoming appointment"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Body</label>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <EditorToolbar editor={bodyEditor} />
                <EditorContent editor={bodyEditor} />
              </div>
            </div>

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false);
                  setNewName("");
                  setNewSubject("");
                  bodyEditor?.commands.setContent("");
                  setSaveError(null);
                }}
                className="px-4 py-2 text-sm text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newName.trim() || saving}
                className="px-4 py-2 text-sm font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save Template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-800">Edit Email Template</h2>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Template name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Default subject</label>
              <input
                type="text"
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Body</label>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <EditorToolbar editor={editBodyEditor} />
                <EditorContent editor={editBodyEditor} />
              </div>
            </div>

            {editError && <p className="text-sm text-red-600">{editError}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setEditName("");
                  setEditSubject("");
                  editBodyEditor?.commands.setContent("");
                  setEditError(null);
                }}
                className="px-4 py-2 text-sm text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={!editName.trim() || editSaving}
                className="px-4 py-2 text-sm font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-40"
              >
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
