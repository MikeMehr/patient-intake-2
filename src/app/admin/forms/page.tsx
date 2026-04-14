"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import SessionKeepAlive from "@/components/auth/SessionKeepAlive";

interface FormTemplate {
  id: string;
  name: string;
  questions: string;
  category: string | null;
  created_at: string;
}

// Group forms by category
function groupByCategory(forms: FormTemplate[]): Record<string, FormTemplate[]> {
  const groups: Record<string, FormTemplate[]> = {};
  for (const form of forms) {
    const key = form.category || "Uncategorized";
    if (!groups[key]) groups[key] = [];
    groups[key].push(form);
  }
  return groups;
}

export default function AdminFormsPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add form modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newQuestions, setNewQuestions] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Expanded categories
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Preview expanded form
  const [expandedFormId, setExpandedFormId] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/forms");
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setTemplates(data.templates || []);
        // Auto-expand all categories on first load
        const cats = new Set<string>(
          (data.templates || []).map((t: FormTemplate) => t.category || "Uncategorized")
        );
        setExpandedCategories(cats);
      }
    } catch {
      setError("Failed to load forms.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddForm = async () => {
    if (!newName.trim() || !newQuestions.trim()) {
      setSaveError("Form name and questions are required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          questions: newQuestions.trim(),
          category: newCategory.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || "Failed to add form.");
        return;
      }
      setTemplates((prev) => [...prev, data.template]);
      const cat = data.template.category || "Uncategorized";
      setExpandedCategories((prev) => new Set([...prev, cat]));
      setShowAddModal(false);
      setNewName("");
      setNewCategory("");
      setNewQuestions("");
    } catch {
      setSaveError("Failed to add form.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteForm = async (id: string) => {
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/forms/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error || "Failed to delete form.");
        return;
      }
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch {
      setDeleteError("Failed to delete form.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const grouped = groupByCategory(templates);
  const categories = Object.keys(grouped).sort((a, b) =>
    a === "Uncategorized" ? 1 : b === "Uncategorized" ? -1 : a.localeCompare(b)
  );

  // Collect existing category names for the datalist
  const existingCategories = Array.from(new Set(templates.map((t) => t.category).filter(Boolean))) as string[];

  return (
    <div className="min-h-screen bg-slate-50">
      <SessionKeepAlive redirectTo="/admin/login" />
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Image
            src="/LogoFinal.png"
            alt="Health Assist AI logo"
            width={196}
            height={45}
            className="mx-auto mb-5 h-[50px] w-[153px] object-cover sm:h-[67px] sm:w-[202px]"
            style={{ objectPosition: "78% center" }}
            priority
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/admin/dashboard"
                className="text-sm text-slate-500 hover:text-slate-700 transition"
              >
                ← Dashboard
              </Link>
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Forms Library</h1>
                <p className="text-sm text-slate-600 mt-1">
                  Manage the master form list inherited by all providers
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setShowAddModal(true); setSaveError(null); }}
                className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition"
              >
                + Add Form
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        {deleteError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-800">{deleteError}</p>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-slate-500 text-sm">Loading forms…</div>
        ) : templates.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg shadow-sm border border-slate-200">
            <p className="text-slate-500 text-sm">No forms yet.</p>
            <p className="text-slate-400 text-xs mt-1">
              Click &quot;+ Add Form&quot; to create the first form in the master library.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {categories.map((cat) => (
              <div key={cat} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                {/* Category header */}
                <button
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className="w-full flex items-center justify-between px-5 py-3 bg-slate-50 hover:bg-slate-100 transition text-left"
                >
                  <span className="font-semibold text-slate-800 text-sm">{cat}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {grouped[cat].length} form{grouped[cat].length !== 1 ? "s" : ""}
                    <svg
                      className={`w-4 h-4 transition-transform ${expandedCategories.has(cat) ? "rotate-180" : ""}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </button>

                {/* Forms list */}
                {expandedCategories.has(cat) && (
                  <ul className="divide-y divide-slate-100">
                    {grouped[cat].map((form) => (
                      <li key={form.id} className="px-5 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedFormId(expandedFormId === form.id ? null : form.id)
                              }
                              className="text-sm font-medium text-slate-800 hover:text-slate-900 text-left flex items-center gap-1"
                            >
                              {form.name}
                              <svg
                                className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expandedFormId === form.id ? "rotate-180" : ""}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            {expandedFormId !== form.id && (
                              <p className="text-xs text-slate-400 mt-0.5 truncate">
                                {form.questions.split("\n")[0]}
                              </p>
                            )}
                            {expandedFormId === form.id && (
                              <pre className="mt-2 text-xs text-slate-600 whitespace-pre-wrap font-sans bg-slate-50 rounded p-3 border border-slate-200">
                                {form.questions}
                              </pre>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteForm(form.id)}
                            disabled={deletingId === form.id}
                            className="shrink-0 text-xs text-red-500 hover:text-red-700 disabled:opacity-50 px-2 py-1 rounded hover:bg-red-50 transition"
                          >
                            {deletingId === form.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Form Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Add New Form</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {saveError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {saveError}
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Form Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Disability Tax Credit"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Category / Folder
                </label>
                <input
                  type="text"
                  list="category-list"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="e.g. Family Doctors, GI, Rheum…"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
                <datalist id="category-list">
                  {existingCategories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <p className="text-xs text-slate-400 mt-1">
                  Type an existing category or create a new one.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Form Questions <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={8}
                  value={newQuestions}
                  onChange={(e) => setNewQuestions(e.target.value)}
                  placeholder={"1. Do you have difficulty walking more than 100 metres?\n2. Can you dress and undress yourself?\n3. …"}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 font-mono"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Enter one question per line, numbered (e.g. 1. Question text).
                </p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddForm}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition"
              >
                {saving ? "Saving…" : "Save Form"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
