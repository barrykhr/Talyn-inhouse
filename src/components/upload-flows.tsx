"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { extractCvStep, uploadCv } from "@/server/cv-actions";
import { suggestBriefStep } from "@/server/discovery-actions";
import { extractJdStep, mapJdCriteriaStep, uploadJd } from "@/server/jd-actions";
import { runAssessment } from "@/server/assessment-actions";
import { StagedProgress, type Stage } from "./staged-progress";
import { Button, Card, Field, Select, buttonClass } from "./ui";

type Phase = "pick" | "running" | "failed" | "ready";

function useStages(initial: Stage[]) {
  const [stages, setStages] = useState(initial);
  const set = (key: string, patch: Partial<Stage>) => setStages((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  return { stages, set, reset: () => setStages(initial) };
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FilePicker({ name, accept, file, onFile, label }: { name: string; accept: string; file: File | null; onFile: (f: File | null) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`rounded-xl border border-dashed px-5 py-8 text-center transition-colors ${drag ? "border-ink bg-sunken" : "border-line-strong bg-[#fbfaf8]"}`}
    >
      <input ref={input} id={name} name={name} type="file" accept={accept} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file ? (
        <div className="text-[14px]">
          <span className="font-medium">{file.name}</span> <span className="text-muted">· {formatSize(file.size)}</span>
          <button type="button" onClick={() => input.current?.click()} className="ml-2 text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline">
            Change
          </button>
        </div>
      ) : (
        <>
          <p className="text-[14px] text-ink-2">{label}</p>
          <p className="mt-1 text-[12.5px] text-muted">PDF or DOCX, up to 4 MB</p>
          <label htmlFor={name} className={buttonClass("secondary", "md", "mt-4 cursor-pointer")}>
            Choose file
          </label>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- JD

export function JdUploadFlow({ roleId = null, onCancelHref, manualHref }: { roleId?: string | null; onCancelHref: string; manualHref?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [error, setError] = useState<string | null>(null);
  const [createdRole, setCreatedRole] = useState<string | null>(roleId);
  const { stages, set, reset } = useStages([
    { key: "upload", label: "Uploading", state: "pending" },
    { key: "extract", label: "Extracting information", state: "pending", slow: true },
    { key: "map", label: "Mapping to criteria", state: "pending", slow: true },
    { key: "ready", label: "Ready for review", state: "pending" },
  ]);

  const run = async (from: "upload" | "extract" | "map" = "upload") => {
    setError(null);
    setPhase("running");
    let rid = createdRole;
    if (from === "upload") {
      reset();
      set("upload", { state: "active", detail: file ? `${file.name} · ${formatSize(file.size)}` : null });
      const fd = new FormData();
      fd.set("jd", file!);
      const r = await uploadJd(roleId, fd).catch(() => ({ error: "Upload failed. Check your connection and try again." }) as const);
      if (!("ok" in r) || !r.ok || !r.roleId) {
        set("upload", { state: "failed", detail: r.error ?? null });
        setError(r.error ?? "Upload failed.");
        return setPhase("failed");
      }
      rid = r.roleId;
      setCreatedRole(rid);
      set("upload", { state: "done" });
    }
    if (from === "upload" || from === "extract") {
      set("extract", { state: "active", detail: "Reading role details and requirements from the JD" });
      const r = await extractJdStep(rid!).catch(() => ({ error: "The request failed. Try again." }) as const);
      if (!("ok" in r) || !r.ok) {
        set("extract", { state: "failed", detail: r.error ?? null });
        setError(r.error ?? "Extraction failed.");
        return setPhase("failed");
      }
      set("extract", { state: "done", detail: r.notice ?? `${r.count ?? 0} details found, each linked to its source` });
    }
    set("map", { state: "active", detail: "Drafting screening criteria from the requirements" });
    const m = await mapJdCriteriaStep(rid!).catch(() => ({ error: "The request failed. Try again." }) as const);
    if (!("ok" in m) || !m.ok) {
      set("map", { state: "failed", detail: m.error ?? null });
      setError(m.error ?? "Mapping failed.");
      return setPhase("failed");
    }
    set("map", { state: "done", detail: m.notice ?? `${m.count ?? 0} criteria proposed — none are active until you approve them` });
    set("ready", { state: "done" });
    setPhase("ready");
    window.location.assign(`/roles/${rid}?tab=description`);
  };

  const failedAt = stages.find((s) => s.state === "failed")?.key as "upload" | "extract" | "map" | undefined;

  return (
    <Card className="p-6">
      {phase === "pick" ? (
        <div className="space-y-4">
          <FilePicker name="jd" accept=".pdf,.docx" file={file} onFile={setFile} label="Drop a job description here" />
          <p className="text-[12.5px] text-muted">
            Talyn keeps the file, extracts the role details and drafts criteria — each linked to the text it came from. You review everything before it&apos;s used.
          </p>
          <div className="flex items-center gap-2">
            {manualHref && (
              <Link href={manualHref} className="text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline">
                Enter details manually instead
              </Link>
            )}
            <div className="ml-auto flex gap-2">
              <Link href={onCancelHref} className={buttonClass("ghost")}>Cancel</Link>
              <Button variant="primary" disabled={!file} onClick={() => run("upload")}>Upload and extract</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <StagedProgress stages={stages} />
          {phase === "failed" && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              {failedAt === "upload" ? (
                <>
                  <Button onClick={() => setPhase("pick")}>Choose another file</Button>
                  {manualHref && <Link href={manualHref} className={buttonClass("ghost")}>Enter details manually</Link>}
                </>
              ) : (
                <>
                  <Button variant="primary" onClick={() => run(failedAt)}>Try again</Button>
                  <Link href={`/roles/${createdRole}?tab=description`} className={buttonClass("ghost")}>Continue and review manually</Link>
                </>
              )}
              <span className="sr-only">{error}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- JD for Discover

/**
 * Discover setup from a JD: upload → extract role details → suggest search fields. With roleId it
 * replaces the role's JD (recruiter-edited fields are kept). Lands on the role's Discover tab to review.
 */
export function DiscoverJdFlow({ roleId = null, compact = false }: { roleId?: string | null; compact?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [rid, setRid] = useState<string | null>(roleId);
  const { stages, set, reset } = useStages([
    { key: "upload", label: "Uploading", state: "pending" },
    { key: "extract", label: "Extracting role details", state: "pending", slow: true },
    { key: "brief", label: "Suggesting search fields", state: "pending", slow: true },
    { key: "ready", label: "Ready for your review", state: "pending" },
  ]);
  const run = async (from: "upload" | "extract" | "brief" = "upload") => {
    setPhase("running");
    let id = rid;
    if (from === "upload") {
      reset();
      set("upload", { state: "active", detail: file ? `${file.name} · ${formatSize(file.size)}` : null });
      const fd = new FormData();
      fd.set("jd", file!);
      const r = await uploadJd(roleId, fd).catch(() => ({ error: "Upload failed. Check your connection and try again." }) as const);
      if (!("ok" in r) || !r.ok || !r.roleId) {
        set("upload", { state: "failed", detail: r.error ?? null });
        return setPhase("failed");
      }
      id = r.roleId;
      setRid(id);
      set("upload", { state: "done" });
    }
    if (from !== "brief") {
      set("extract", { state: "active", detail: "Title, location and requirements, each linked to the JD text" });
      const r = await extractJdStep(id!).catch(() => ({ error: "The request failed. Try again." }) as const);
      if (!("ok" in r) || !r.ok) {
        set("extract", { state: "failed", detail: r.error ?? null });
        return setPhase("failed");
      }
      set("extract", { state: "done", detail: r.notice ?? null });
    }
    set("brief", { state: "active", detail: "Skills, experience, location and a Boolean query — only what the JD states" });
    const b: { ok?: boolean; error?: string; notice?: string | null } = await suggestBriefStep(id!).catch(() => ({ error: "The request failed. Try again." }));
    if (!b.ok) {
      set("brief", { state: "failed", detail: b.error ?? null });
      return setPhase("failed");
    }
    set("brief", { state: "done", detail: b.notice ?? "Nothing is searched until you review and confirm the fields" });
    set("ready", { state: "done" });
    setPhase("ready");
    window.location.assign(`/roles/${id}/discover?setup=jd#setup`);
  };
  const failedAt = stages.find((s) => s.state === "failed")?.key as "upload" | "extract" | "brief" | undefined;
  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {phase === "pick" ? (
        <>
          <FilePicker name="jd" accept=".pdf,.docx" file={file} onFile={setFile} label={roleId ? "Drop a replacement job description" : "Drop a job description here"} />
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12.5px] text-muted">PDF or DOCX, up to 4 MB. Suggested fields are labeled with where they came from; anything the JD doesn&apos;t say stays empty.</p>
            <Button variant="primary" className="ml-auto" disabled={!file} onClick={() => run("upload")}>
              {roleId ? "Replace and re-suggest" : "Upload and extract"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <StagedProgress stages={stages} />
          {phase === "failed" && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              {failedAt === "upload" ? (
                <Button onClick={() => setPhase("pick")}>Choose another file</Button>
              ) : (
                <>
                  <Button variant="primary" onClick={() => run(failedAt)}>
                    Try again
                  </Button>
                  {rid && (
                    <Link href={`/roles/${rid}/discover#setup`} className={buttonClass("ghost")}>
                      Fill in the fields myself
                    </Link>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- CV

export type RoleOption = { id: string; title: string; approvedCriteria: number };

export function CvUploadFlow({ roles, defaultRole, aiConfigured, onManual }: { roles: RoleOption[]; defaultRole: string; aiConfigured: boolean; onManual: (error?: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [roleId, setRoleId] = useState(defaultRole);
  const [assess, setAssess] = useState(true);
  const [phase, setPhase] = useState<Phase>("pick");
  const [ids, setIds] = useState<{ candidateId: string; applicationId: string | null } | null>(null);
  const role = roles.find((r) => r.id === roleId);
  const canMap = !!role && role.approvedCriteria > 0 && aiConfigured;
  const willMap = canMap && assess;
  const { stages, set, reset } = useStages([
    { key: "upload", label: "Uploading", state: "pending" },
    { key: "extract", label: "Extracting information", state: "pending", slow: true },
    { key: "map", label: "Mapping to criteria", state: "pending", slow: true },
    { key: "ready", label: "Ready for review", state: "pending" },
  ]);
  const href = (cid: string) => `/candidates/${cid}${roleId ? `?role=${roleId}` : ""}`;

  const run = async (from: "upload" | "extract" | "map" = "upload") => {
    setPhase("running");
    let cur = ids;
    if (from === "upload") {
      reset();
      set("upload", { state: "active", detail: file ? `${file.name} · ${formatSize(file.size)}` : null });
      const fd = new FormData();
      fd.set("cv", file!);
      if (roleId) fd.set("roleId", roleId);
      const r = await uploadCv(fd).catch(() => ({ error: "Upload failed. Check your connection and try again." }) as const);
      if (!("ok" in r) || !r.ok || !r.candidateId) {
        set("upload", { state: "failed", detail: r.error ?? null });
        return setPhase("failed");
      }
      cur = { candidateId: r.candidateId, applicationId: r.applicationId ?? null };
      setIds(cur);
      set("upload", { state: "done" });
    }
    if (from === "upload" || from === "extract") {
      set("extract", { state: "active", detail: "Reading contact details, experience, education and skills" });
      const r = await extractCvStep(cur!.candidateId).catch(() => ({ error: "The request failed. Try again." }) as const);
      if (!("ok" in r) || !r.ok) {
        set("extract", { state: "failed", detail: r.error ?? null });
        return setPhase("failed");
      }
      set("extract", { state: "done", detail: r.notice ?? `${r.count ?? 0} details found, each linked to the CV` });
    }
    if (willMap && cur!.applicationId) {
      set("map", { state: "active", detail: `Checking the CV against ${role!.approvedCriteria} approved criteria for ${role!.title}` });
      const r: { ok?: boolean; error?: string } | undefined = await runAssessment(cur!.applicationId, "ai").catch(() => ({ error: "The request failed. Try again." }));
      if (!r?.ok) {
        set("map", { state: "failed", detail: r?.error ?? null });
        return setPhase("failed");
      }
      set("map", { state: "done", detail: "Assessment drafted for your review" });
    } else {
      set("map", {
        state: "skipped",
        detail: !role ? "No role selected" : role.approvedCriteria === 0 ? "This role has no approved criteria yet" : !aiConfigured ? "AI is off" : "Skipped — you can assess later",
      });
    }
    set("ready", { state: "done" });
    setPhase("ready");
    window.location.assign(href(cur!.candidateId));
  };

  const failedAt = stages.find((s) => s.state === "failed")?.key as "upload" | "extract" | "map" | undefined;
  const failedDetail = stages.find((s) => s.state === "failed")?.detail ?? undefined;

  return (
    <Card className="p-6">
      {phase === "pick" ? (
        <div className="space-y-4">
          <FilePicker name="cv" accept=".pdf,.docx" file={file} onFile={setFile} label="Drop a CV here" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role">
              <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">No role yet</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.title}</option>
                ))}
              </Select>
            </Field>
            {canMap && (
              <label className="flex items-start gap-2 self-end pb-1 text-[13px] text-ink-2">
                <input type="checkbox" checked={assess} onChange={(e) => setAssess(e.target.checked)} className="mt-0.5 accent-[var(--color-ink)]" />
                <span>
                  Also map the CV to this role&apos;s {role!.approvedCriteria} approved criteria
                  <span className="block text-[12px] text-muted">A draft assessment for you to review. It doesn&apos;t move or decide anything.</span>
                </span>
              </label>
            )}
          </div>
          <p className="text-[12.5px] text-muted">
            Contact details are read on Talyn&apos;s servers and never sent to an AI provider. Everything extracted waits for your review.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onManual()} className="text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline">
              Enter details manually instead
            </button>
            <div className="ml-auto flex gap-2">
              <Link href={roleId ? `/roles/${roleId}` : "/candidates"} className={buttonClass("ghost")}>Cancel</Link>
              <Button variant="primary" disabled={!file} onClick={() => run("upload")}>Upload and extract</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <StagedProgress stages={stages.filter((s) => s.key !== "map" || willMap || s.state === "skipped")} />
          {phase === "failed" && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              {failedAt === "upload" ? (
                <>
                  <Button onClick={() => setPhase("pick")}>Choose another file</Button>
                  <Button variant="ghost" onClick={() => onManual(failedDetail)}>Enter details manually</Button>
                </>
              ) : (
                <>
                  <Button variant="primary" onClick={() => run(failedAt)}>Try again</Button>
                  <a href={href(ids!.candidateId)} className={buttonClass("ghost")}>Continue to the candidate</a>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
