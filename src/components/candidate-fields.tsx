import { Field, Input, Textarea } from "./ui";

type Values = {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  candidateSummary?: string | null;
};

export function CandidateFields({ v = {} }: { v?: Values }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" className="sm:col-span-2">
        <Input name="fullName" defaultValue={v.fullName} required maxLength={160} />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" defaultValue={v.email ?? ""} maxLength={200} />
      </Field>
      <Field label="Phone">
        <Input name="phone" defaultValue={v.phone ?? ""} maxLength={60} />
      </Field>
      <Field label="Current title">
        <Input name="currentTitle" defaultValue={v.currentTitle ?? ""} maxLength={160} />
      </Field>
      <Field label="Current company">
        <Input name="currentCompany" defaultValue={v.currentCompany ?? ""} maxLength={160} />
      </Field>
      <Field label="Location">
        <Input name="location" defaultValue={v.location ?? ""} maxLength={160} />
      </Field>
      <Field label="LinkedIn URL">
        <Input name="linkedinUrl" type="url" defaultValue={v.linkedinUrl ?? ""} placeholder="https://" maxLength={300} />
      </Field>
      <Field
        label="Candidate-provided information"
        hint="Application answers or a summary the candidate gave you. This can be cited as evidence. Put your own observations in notes instead."
        className="sm:col-span-2"
      >
        <Textarea name="candidateSummary" defaultValue={v.candidateSummary ?? ""} rows={4} maxLength={20000} />
      </Field>
    </div>
  );
}
