"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  isGlobal: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  const btn = (active: boolean, onClick: () => void, label: string, children: React.ReactNode) => (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`px-2 py-1 rounded text-sm font-medium transition ${
        active
          ? "bg-slate-700 text-white"
          : "text-slate-600 hover:bg-slate-100"
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
      <div className="w-px h-4 bg-slate-200 mx-1" />
      {btn(false, () => {
        const url = window.prompt("Link URL");
        if (url) editor.chain().focus().setLink({ href: url }).run();
      }, "Insert link", "🔗")}
      {editor.isActive("link") && btn(false, () => editor.chain().focus().unsetLink().run(), "Remove link", "✕ Link")}
    </div>
  );
}

export default function EmailPage() {
  const searchParams = useSearchParams();
  const toParam = searchParams.get("to") || "";
  const nameParam = searchParams.get("name") || "";

  const [to, setTo] = useState(toParam);
  const [subject, setSubject] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [defaultBodyLoaded, setDefaultBodyLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultBodyEdit, setDefaultBodyEdit] = useState("");
  const [sending, setSending] = useState(false);
  const [bodyEmpty, setBodyEmpty] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Edit template modal state
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editTemplateName, setEditTemplateName] = useState("");
  const [editTemplateSubject, setEditTemplateSubject] = useState("");
  const [editTemplateSaving, setEditTemplateSaving] = useState(false);
  const [editTemplateError, setEditTemplateError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templatesRef = useRef<HTMLDivElement>(null);
  const defaultBodyEditorRef = useRef<ReturnType<typeof useEditor> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TiptapLink.configure({ openOnClick: false }),
    ],
    content: "",
    onUpdate: ({ editor }) => {
      setBodyEmpty(editor.isEmpty);
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-[300px] px-4 py-3 focus:outline-none text-slate-800",
      },
    },
  });

  const settingsEditor = useEditor({
    extensions: [StarterKit, Underline, TiptapLink.configure({ openOnClick: false })],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-[160px] px-4 py-3 focus:outline-none text-slate-800",
      },
    },
  });

  const editTemplateEditor = useEditor({
    extensions: [StarterKit, Underline, TiptapLink.configure({ openOnClick: false })],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-[200px] px-4 py-3 focus:outline-none text-slate-800",
      },
    },
  });

  // Load default body and templates on mount
  useEffect(() => {
    async function load() {
      const [settingsRes, templatesRes] = await Promise.all([
        fetch("/api/physician/email/settings"),
        fetch("/api/physician/email/templates"),
      ]);

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        const greeting = nameParam
          ? `<p>Hello ${nameParam},</p><p></p>`
          : "";
        const body = greeting + (data.defaultBody || "");
        editor?.commands.setContent(body);
        if (editor) setBodyEmpty(editor.isEmpty);
        setDefaultBodyLoaded(true);
      }

      if (templatesRes.ok) {
        const data = await templatesRes.json();
        setTemplates(data.templates || []);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameParam]);

  // Close templates dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (templatesRef.current && !templatesRef.current.contains(e.target as Node)) {
        setTemplatesOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleApplyTemplate = (tpl: EmailTemplate) => {
    setSubject(tpl.subject);
    const greeting = nameParam ? `<p>Hello ${nameParam},</p><p></p>` : "";
    editor?.commands.setContent(greeting + tpl.body);
    if (editor) setBodyEmpty(editor.isEmpty);
    setTemplatesOpen(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachments((prev) => [...prev, ...files].slice(0, 5));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSend = async () => {
    if (!to || !subject || !editor) return;
    setSending(true);
    setSendResult(null);

    const fd = new FormData();
    fd.append("to", to);
    fd.append("subject", subject);
    fd.append("body", editor.getHTML());
    attachments.forEach((f) => fd.append("files", f));

    try {
      const res = await fetch("/api/physician/email/send", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        setSendResult({ ok: true, msg: "Email sent successfully." });
        setTo("");
        setSubject("");
        editor.commands.setContent("");
        setBodyEmpty(true);
        setAttachments([]);
      } else {
        setSendResult({ ok: false, msg: data.error || "Failed to send email." });
      }
    } catch {
      setSendResult({ ok: false, msg: "An unexpected error occurred." });
    } finally {
      setSending(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim() || !editor) return;
    setSavingTemplate(true);
    try {
      const res = await fetch("/api/physician/email/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName.trim(),
          subject,
          body: editor.getHTML(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTemplates((prev) => [...prev, { ...data.template, isGlobal: false }]);
        setSaveTemplateOpen(false);
        setTemplateName("");
      }
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    const res = await fetch(`/api/physician/email/templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    }
  };

  const handleEditTemplate = (tpl: EmailTemplate) => {
    setEditingTemplateId(tpl.id);
    setEditTemplateName(tpl.name);
    setEditTemplateSubject(tpl.subject);
    editTemplateEditor?.commands.setContent(tpl.body || "");
    setEditTemplateError(null);
    setTemplatesOpen(false);
  };

  const handleSaveEditTemplate = async () => {
    if (!editingTemplateId || !editTemplateName.trim() || !editTemplateEditor) return;
    setEditTemplateSaving(true);
    setEditTemplateError(null);
    try {
      const res = await fetch(`/api/physician/email/templates/${editingTemplateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editTemplateName.trim(),
          subject: editTemplateSubject.trim(),
          body: editTemplateEditor.getHTML(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditTemplateError(data.error || "Failed to update template.");
        return;
      }
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === editingTemplateId
            ? {
                ...t,
                name: editTemplateName.trim(),
                subject: editTemplateSubject.trim(),
                body: editTemplateEditor.getHTML(),
              }
            : t
        )
      );
      setEditingTemplateId(null);
      setEditTemplateName("");
      setEditTemplateSubject("");
      editTemplateEditor.commands.setContent("");
    } catch {
      setEditTemplateError("An unexpected error occurred.");
    } finally {
      setEditTemplateSaving(false);
    }
  };

  const openSettings = useCallback(() => {
    fetch("/api/physician/email/settings").then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        settingsEditor?.commands.setContent(data.defaultBody || "");
        setDefaultBodyEdit(data.defaultBody || "");
      }
    });
    setSettingsOpen(true);
  }, [settingsEditor]);

  const handleSaveSettings = async () => {
    if (!settingsEditor) return;
    setSavingSettings(true);
    try {
      await fetch("/api/physician/email/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultBody: settingsEditor.getHTML() }),
      });
      setSettingsOpen(false);
    } finally {
      setSavingSettings(false);
    }
  };

  const canSend = to.trim() && subject.trim() && editor && !bodyEmpty && !sending;

  return (
    <div className="min-h-screen bg-slate-50">
      <SessionKeepAlive redirectTo="/auth/login" />

      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Link
            href="/physician/dashboard"
            className="text-sm text-slate-500 hover:text-slate-700 transition"
          >
            ← Dashboard
          </Link>
          <span className="text-slate-300">/</span>
          <h1 className="text-base font-semibold text-slate-800">Email</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Send a one-way email to a patient. Replies will go to your clinic&apos;s email address.
        </p>
      </div>

      {/* Main content */}
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">

        {/* Recipient */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Recipient email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="patient@example.com"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Subject <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Enter email subject"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>
        </div>

        {/* Body */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          {/* Toolbar row */}
          <div className="flex items-center justify-between px-3 pt-3 pb-0 gap-2">
            <span className="text-sm font-semibold text-slate-700">Message body</span>
            <div className="flex items-center gap-2">
              {/* Settings gear */}
              <button
                type="button"
                onClick={openSettings}
                title="Edit default email body"
                className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>

              {/* Templates dropdown */}
              <div className="relative" ref={templatesRef}>
                <button
                  type="button"
                  onClick={() => setTemplatesOpen((o) => !o)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
                >
                  Templates
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {templatesOpen && (
                  <div className="absolute right-0 top-9 z-50 w-72 rounded-xl border border-slate-200 bg-white shadow-lg">
                    <div className="p-2 border-b border-slate-100">
                      <span className="text-xs font-semibold text-slate-500 px-2">Your templates</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {templates.length === 0 && (
                        <p className="px-4 py-3 text-sm text-slate-400">No templates yet.</p>
                      )}
                      {templates.map((tpl) => (
                        <div
                          key={tpl.id}
                          className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 group"
                        >
                          <button
                            type="button"
                            onClick={() => handleApplyTemplate(tpl)}
                            className="flex-1 text-left text-sm text-slate-700 truncate"
                          >
                            {tpl.name}
                            {tpl.isGlobal && (
                              <span className="ml-2 text-xs text-blue-500 font-medium">Global</span>
                            )}
                          </button>
                          {!tpl.isGlobal && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleEditTemplate(tpl)}
                                className="opacity-0 group-hover:opacity-100 ml-2 text-xs text-blue-500 hover:text-blue-700 transition"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTemplate(tpl.id)}
                                className="opacity-0 group-hover:opacity-100 ml-2 text-xs text-red-400 hover:text-red-600 transition"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-slate-100 p-2">
                      <button
                        type="button"
                        onClick={() => { setSaveTemplateOpen(true); setTemplatesOpen(false); }}
                        className="w-full text-left px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50 rounded"
                      >
                        + Save current as template
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Editor */}
          <div className="mt-3 border border-slate-200 rounded-lg mx-4 mb-4 overflow-hidden">
            <EditorToolbar editor={editor} />
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Attachments */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-slate-700">
              Attachments
              <span className="ml-1 font-normal text-slate-400">(up to 5 files, 10 MB each)</span>
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={attachments.length >= 5}
              className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-40 transition"
            >
              + Add file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {attachments.length > 0 && (
            <ul className="space-y-2">
              {attachments.map((f, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-slate-400">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="text-sm text-slate-700 truncate">{f.name}</span>
                    <span className="text-xs text-slate-400 shrink-0">({formatBytes(f.size)})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="text-slate-400 hover:text-red-500 transition ml-2 text-xs"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {attachments.length === 0 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-lg border-2 border-dashed border-slate-200 py-6 text-sm text-slate-400 hover:border-slate-300 hover:text-slate-500 transition"
            >
              Click to attach files, or drag and drop
            </button>
          )}
        </div>

        {/* Send result */}
        {sendResult && (
          <div className={`rounded-lg px-4 py-3 text-sm font-medium ${sendResult.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {sendResult.msg}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end pb-8">
          <button
            type="button"
            onClick={() => setSaveTemplateOpen(true)}
            className="px-4 py-2 text-sm font-medium text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
          >
            Save as template
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="px-6 py-2 text-sm font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-40 transition"
          >
            {sending ? "Sending…" : "Send Email"}
          </button>
        </div>
      </div>

      {/* Save Template Modal */}
      {saveTemplateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-800">Save as Template</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Template name</label>
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. Lab results follow-up"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                autoFocus
              />
            </div>
            <p className="text-xs text-slate-500">The current subject and body will be saved.</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setSaveTemplateOpen(false); setTemplateName(""); }}
                className="px-4 py-2 text-sm text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={!templateName.trim() || savingTemplate}
                className="px-4 py-2 text-sm font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-40"
              >
                {savingTemplate ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Default Body Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-800">Default Email Body</h2>
            <p className="text-xs text-slate-500">
              This text appears automatically when composing a new email. You can modify it per email.
            </p>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <EditorToolbar editor={settingsEditor} />
              <EditorContent editor={settingsEditor} />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="px-4 py-2 text-sm font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-40"
              >
                {savingSettings ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Template Modal */}
      {editingTemplateId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-800">Edit Template</h2>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Template name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={editTemplateName}
                onChange={(e) => setEditTemplateName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
              <input
                type="text"
                value={editTemplateSubject}
                onChange={(e) => setEditTemplateSubject(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Body</label>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <EditorToolbar editor={editTemplateEditor} />
                <EditorContent editor={editTemplateEditor} />
              </div>
            </div>

            {editTemplateError && <p className="text-sm text-red-600">{editTemplateError}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingTemplateId(null);
                  setEditTemplateName("");
                  setEditTemplateSubject("");
                  editTemplateEditor?.commands.setContent("");
                  setEditTemplateError(null);
                }}
                className="px-4 py-2 text-sm text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEditTemplate}
                disabled={!editTemplateName.trim() || editTemplateSaving}
                className="px-4 py-2 text-sm font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-40"
              >
                {editTemplateSaving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
