// Candidate-facing messages built only from facts Talyn holds. Nothing is invented about the
// person or the role; the recruiter can add one line of their own.

const first = (name: string) => name.trim().split(/\s+/)[0] || "there";

export function interestMessage(i: { candidateName: string; recruiter: string; company: string; roleTitle: string; location?: string | null; line?: string | null; url: string }) {
  return [
    `Hi ${first(i.candidateName)},`,
    "",
    `I'm ${i.recruiter}, hiring for the ${i.roleTitle} role at ${i.company}${i.location ? ` (${i.location})` : ""}.${i.line?.trim() ? ` ${i.line.trim()}` : ""}`,
    "",
    "Would you be open to hearing more? You can answer in one click here:",
    i.url,
    "",
    "If it's not for you, you can say so on the same page and we won't follow up about this role.",
    "",
    i.recruiter,
  ].join("\n");
}

export function bookingLine(url: string) {
  return `Or pick the time that suits you here, and you'll get the invitation straight away:\n${url}`;
}
