"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { createRefFolder, deleteRefFolder, uploadRefDoc, deleteRefDoc } from "./reference-actions";

export interface RefDoc {
  id: string;
  doc_name: string;
  tags: string[];
  storage_path: string | null;
  uploaded_at: string;
}

export interface RefFolder {
  id: string;
  name: string;
  position: number;
  created_at: string;
  docs: RefDoc[];
}

export function RefBoardClient({ folders }: { folders: RefFolder[] }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submitNewFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    start(async () => {
      const res = await createRefFolder(newName.trim());
      if (!res.ok) { setError(res.error); return; }
      setNewName("");
      setCreating(false);
    });
  }

  return (
    <div style={{ background: "#0A0B14", minHeight: "100vh", padding: "32px 24px", fontFamily: "var(--font-body, DM Sans, sans-serif)" }}>
      <div style={{ maxWidth: "960px", margin: "0 auto" }}>
        {/* Back */}
        <Link
          href="/dashboard/lending"
          style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "rgba(255,255,255,0.35)", textDecoration: "none", marginBottom: "20px" }}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Lending
        </Link>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "2rem", fontWeight: 300, color: "#fff", fontFamily: "var(--font-display, 'Cormorant Garamond', serif)", letterSpacing: "-0.02em", marginBottom: "4px" }}>
              Reference Docs
            </h1>
            <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)" }}>
              Upload addendum templates · AI uses these when drafting
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            style={{
              background: "#C9A84C",
              border: "none",
              borderRadius: "10px",
              padding: "9px 20px",
              fontSize: "13px",
              fontWeight: 600,
              color: "#0A0B14",
              cursor: "pointer",
            }}
          >
            + New Folder
          </button>
        </div>

        {/* New folder form */}
        {creating && (
          <form
            onSubmit={submitNewFolder}
            style={{ display: "flex", gap: "8px", marginBottom: "16px" }}
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Folder name"
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(201,168,76,0.5)",
                borderRadius: "10px",
                padding: "9px 14px",
                fontSize: "13px",
                color: "#fff",
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={pending}
              style={{ background: "#C9A84C", border: "none", borderRadius: "10px", padding: "9px 16px", fontSize: "13px", fontWeight: 600, color: "#0A0B14", cursor: "pointer" }}
            >
              {pending ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "9px 16px", fontSize: "13px", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}
            >
              Cancel
            </button>
          </form>
        )}
        {error && <p style={{ fontSize: "12px", color: "#ef4444", marginBottom: "12px" }}>{error}</p>}

        {/* Folder grid */}
        {folders.length === 0 && !creating ? (
          <div style={{ background: "#1a1d27", borderRadius: "16px", border: "2px dashed #2a2d3a", padding: "60px 24px", textAlign: "center" }}>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "14px" }}>
              No reference folders yet. Create one to start uploading addendum templates.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {folders.map((folder) => (
              <FolderCard key={folder.id} folder={folder} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FolderCard({ folder }: { folder: RefFolder }) {
  const [expanded, setExpanded] = useState(true);
  const [uploading, startUpload] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setUploadError(null);
    startUpload(async () => {
      const res = await uploadRefDoc(folder.id, fd);
      if (!res.ok) setUploadError(res.error);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function handleDeleteFolder() {
    if (!confirm(`Delete folder "${folder.name}" and all its docs?`)) return;
    startDelete(async () => {
      await deleteRefFolder(folder.id);
    });
  }

  return (
    <div style={{ background: "#1a1d27", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
      {/* Folder header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px" }}>
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", flex: 1, textAlign: "left" }}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#fff" }}>{folder.name}</span>
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>{folder.docs.length} doc{folder.docs.length !== 1 ? "s" : ""}</span>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0)", transition: "transform 150ms ease", marginLeft: "2px" }}>
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        {/* Upload button */}
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            padding: "5px 10px",
            fontSize: "11px",
            color: "rgba(255,255,255,0.5)",
            cursor: uploading ? "not-allowed" : "pointer",
            opacity: uploading ? 0.6 : 1,
          }}
        >
          <input
            ref={fileRef}
            type="file"
            style={{ display: "none" }}
            onChange={handleUpload}
            disabled={uploading}
            accept=".pdf,.doc,.docx,.txt"
          />
          {uploading ? "Uploading…" : "Upload"}
        </label>

        {/* Delete folder */}
        <button
          onClick={handleDeleteFolder}
          disabled={deleting}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.2)", padding: "4px", transition: "color 150ms ease" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.2)"; }}
          aria-label="Delete folder"
          title="Delete folder"
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
          </svg>
        </button>
      </div>

      {uploadError && (
        <p style={{ fontSize: "11px", color: "#ef4444", padding: "0 20px 12px" }}>{uploadError}</p>
      )}

      {/* Doc list */}
      {expanded && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {folder.docs.length === 0 ? (
            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)", padding: "12px 20px" }}>
              No docs yet — upload a template above.
            </p>
          ) : (
            folder.docs.map((doc) => (
              <DocRow key={doc.id} doc={doc} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DocRow({ doc }: { doc: RefDoc }) {
  const [deleting, startDelete] = useTransition();

  function handleDelete() {
    if (!confirm(`Delete "${doc.doc_name}"?`)) return;
    startDelete(async () => {
      await deleteRefDoc(doc.id, doc.storage_path);
    });
  }

  const ext = doc.doc_name.split(".").pop()?.toUpperCase() ?? "";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        transition: "background 150ms ease",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      {/* File icon */}
      <div
        style={{
          width: "28px",
          height: "28px",
          borderRadius: "6px",
          background: "rgba(201,168,76,0.1)",
          border: "1px solid rgba(201,168,76,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: "8px", fontWeight: 700, color: "#C9A84C", letterSpacing: "0.05em" }}>
          {ext}
        </span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {doc.doc_name}
        </div>
        {doc.tags.length > 0 && (
          <div style={{ display: "flex", gap: "4px", marginTop: "2px", flexWrap: "wrap" }}>
            {doc.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: "9px",
                  fontWeight: 600,
                  background: "rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.45)",
                  borderRadius: "999px",
                  padding: "1px 6px",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={handleDelete}
        disabled={deleting}
        style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.2)", padding: "4px", transition: "color 150ms ease", flexShrink: 0 }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.2)"; }}
        aria-label={`Delete ${doc.doc_name}`}
        title="Delete"
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 5l14 14M19 5L5 19" />
        </svg>
      </button>
    </div>
  );
}
