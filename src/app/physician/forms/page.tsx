"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import SessionKeepAlive from "@/components/auth/SessionKeepAlive";

interface PhysicianFormItem {
  id: string;
  name: string;
  questions: string;
  category: string | null;
  isInherited: boolean;
  isEdited: boolean;
  isFavourite: boolean;
  sourceTemplateId: string | null;
}

function groupByCategory(forms: PhysicianFormItem[]): Record<string, PhysicianFormItem[]> {
  const groups: Record<string, PhysicianFormItem[]> = {};
  for (const form of forms) {
    const key = form.category || "Uncategorized";
    if (!groups[key]) groups[key] = [];
    groups[key].push(form);
  }
  // Sort within each group: favourites first, then alphabetical
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => {
      if (a.isFavourite && !b.isFavourite) return -1;
      if (!a.isFavourite && b.isFavourite) return 1;
      return a.name.localeCompare(b.name);
    });
  }
  return groups;
}

export default function PhysicianFormsPage() {
  const router = useRouter();
  const [forms, setForms] = useState<PhysicianFormItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expanded categories
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Preview expanded form id
  const [expandedFormId, setExpandedFormId] = useState<string | null>(null);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newQuestions, setNewQuestions] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Edit form state
  const [editingForm, setEditingForm] = useState<PhysicianFormItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editQuestions, setEditQuestions] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Favourite toggling
  const [togglingFavId, setTogglingFavId] = useState<string | null>(null);

  const addFormRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchForms();
  }, []);

  const fetchForms = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/physician/forms");
      if (res.status === 401) {
        router.push("/physician/login");
        return;
      }
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setForms(data.forms || []);
        const cats = new Set<string>(
          (data.forms || []).map((f: PhysicianFormItem) => f.category || "Uncategorized")
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
      const res = await fetch("/api/physician/forms", {
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
      setForms((prev) => [...prev, data.form]);
      const cat = data.form.category || "Uncategorized";
      setExpandedCategories((prev) => new Set([...prev, cat]));
      setShowAddForm(false);
      setNewName("");
      setNewCategory("");
      setNewQuestions("");
    } catch {
      setSaveError("Failed to add form.");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (form: PhysicianFormItem) => {
    setEditingForm(form);
    setEditName(form.name);
    setEditCategory(form.category || "");
    setEditQuestions(form.questions);
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingForm) return;
    if (!editName.trim() || !editQuestions.trim()) {
      setEditError("Form name and questions are required.");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/physician/forms/${editingForm.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          questions: editQuestions.trim(),
          category: editCategory.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || "Failed to save changes.");
        return;
      }
      setForms((prev) =>
        prev.map((f) => (f.id === editingForm.id ? { ...data.form } : f))
      );
      setEditingForm(null);
    } catch {
      setEditError("Failed to save changes.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this form from your list? This will not affect other providers.")) return;
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/physician/forms/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error || "Failed to remove form.");
        return;
      }
      setForms((prev) => prev.filter((f) => f.id !== id));
    } catch {
      setDeleteError("Failed to remove form.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleFavourite = async (form: PhysicianFormItem) => {
    setTogglingFavId(form.id);
    const newFav = !form.isFavourite;
    try {
      const res = await fetch(`/api/physician/forms/${form.id}/favourite`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavourite: newFav }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Failed to toggle favourite:", data.error);
        return;
      }
      // If the id changed (inherited template created a new shadow row), re-fetch
      setForms((prev) =>
        prev.map((f) =>
          f.id === form.id ? { ...f, isFavourite: newFav } : f
        )
      );
      // Re-fetch to get updated ids from shadow rows
      fetchForms();
    } catch {
      console.error("Failed to toggle favourite.");
    } finally {
      setTogglingFavId(null);
    }
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const grouped = groupByCategory(forms);
  const categories = Object.keys(grouped).sort((a, b) =>
    a === "Uncategorized" ? 1 : b === "Uncategorized" ? -1 : a.localeCompare(b)
  );
  const existingCategories = Array.from(
    new Set(forms.map((f) => f.category).filter(Boolean))
  ) as string[];

  return (
    <div className="min-h-screen bg-slate-50">
      <SessionKeepAlive redirectTo="/physician/login" />

      {/* Header — matches physician dashboard style */}
      <div className="relative bg-white rounded-b-none shadow-sm border-b border-slate-200 p-4 sm:p-6 mb-0">
        <Image
          src="/LogoFinal.png"
          alt="Health Assist AI logo"
          width={112}
          height={26}
          className="mx-auto mb-2 h-[38px] w-[114px] object-contain sm:h-[50px] sm:w-[150px]"
          priority
        />
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Link
              href="/physician/dashboard"
              className="text-sm text-slate-500 hover:text-slate-700 transition"
            >
              ← Dashboard
            </Link>
            <div>
              <h1 className="text-[0.95rem] sm:text-[1.1rem] font-semibold text-slate-900">
                My Forms Library
              </h1>
              <p className="text-[0.7rem] sm:text-[0.8rem] text-slate-500 mt-0.5">
                Manage your saved forms. Inherited forms come from the system library.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowAddForm(true);
              setSaveError(null);
              setTimeout(() => addFormRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
            }}
            className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition"
          >
            + Add Form
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        {deleteError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-800">{deleteError}</p>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-slate-500 text-sm">Loading your forms…</div>
        ) : forms.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg shadow-sm border border-slate-200">
            <p className="text-slate-500 text-sm">No forms in your library yet.</p>
            <p className="text-slate-400 text-xs mt-1">
              Add a form below, or ask your Super Admin to add templates to the shared library.
            </p>
          </div>
        ) : (
          categories.map((cat) => (
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

              {expandedCategories.has(cat) && (
                <ul className="divide-y divide-slate-100">
                  {grouped[cat].map((form) => (
                    <li key={form.id} className="px-5 py-3">
                      <div className="flex items-start gap-3">
                        {/* Favourite star */}
                        <button
                          type="button"
                          onClick={() => handleToggleFavourite(form)}
                          disabled={togglingFavId === form.id}
                          title={form.isFavourite ? "Remove from favourites" : "Add to favourites"}
                          className={`shrink-0 mt-0.5 text-lg leading-none transition ${
                            form.isFavourite ? "text-yellow-400 hover:text-yellow-300" : "text-slate-300 hover:text-yellow-400"
                          } disabled:opacity-50`}
                        >
                          ★
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
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
                            {form.isInherited && !form.isEdited && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 font-medium">
                                Inherited
                              </span>
                            )}
                            {form.isEdited && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 font-medium">
                                Customised
                              </span>
                            )}
                          </div>
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

                        {/* Actions */}
                        <div className="shrink-0 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(form)}
                            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-50 transition"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(form.id)}
                            disabled={deletingId === form.id}
                            className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50 px-2 py-1 rounded hover:bg-red-50 transition"
                          >
                            {deletingId === form.id ? "…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}

        {/* Add New Form inline */}
        {showAddForm && (
          <div ref={addFormRef} className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-800">Add New Form</h3>
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
                list="physician-category-list"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="e.g. Family Doctors, GI…"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
              <datalist id="physician-category-list">
                {existingCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
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
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowAddForm(false); setSaveError(null); }}
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
        )}
      </div>

      {/* Edit Form Modal */}
      {editingForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Edit Form</h2>
                {editingForm.isInherited && !editingForm.isEdited && (
                  <p className="text-xs text-blue-600 mt-0.5">
                    This inherited form will be customised for your account only.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setEditingForm(null)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {editError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {editError}
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Form Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Category / Folder
                </label>
                <input
                  type="text"
                  list="physician-edit-category-list"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
                <datalist id="physician-edit-category-list">
                  {existingCategories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Form Questions <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={9}
                  value={editQuestions}
                  onChange={(e) => setEditQuestions(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 font-mono"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingForm(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={editSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition"
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
