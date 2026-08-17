// Single source of truth for departments and gender.
// Use these everywhere — the leaderboard filter AND the profile form — so the
// two can never drift apart.

export const DEPARTMENTS = [
  "Analytics",
  "Banking",
  "Business",
  "Call Center",
  "Concierge",
  "COO Office",
  "Corporate Real Estate & Workplace Services",
  "Curlec",
  "Customer Success",
  "Design",
  "Engineering",
  "Enterprise Sales",
  "Finance",
  "Founder's Office",
  "Group Compliance",
  "GTM",
  "Key Account Management",
  "Learning and Development",
  "Legal",
  "MagicCheckout",
  "Marketing",
  "Mid Market",
  "New Initiatives Team",
  "Online Payments Sales",
  "Partnerships",
  "People Operations",
  "Product",
  "Risk",
  "Sales",
  "SME",
  "Solutions",
  "Strategy",
  "Underwriting & Risk",
  "Vigilance",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const GENDERS = ["Male", "Female", "Other"] as const;
export type Gender = (typeof GENDERS)[number];

/** Shown for rows whose stored department isn't on the official list. */
export const UNLISTED = "Unlisted";

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")       // "Underwriting & Risk" === "Underwriting and Risk"
    .replace(/[\u2018\u2019']/g, "")  // straight or curly apostrophes
    .replace(/[^a-z0-9]+/g, "");

const DEPT_LOOKUP = new Map<string, Department>(DEPARTMENTS.map((d) => [key(d), d]));

// Old free-text values that should map onto an official department.
// Add entries here as you find them — left side is what's in the database.
const DEPT_ALIASES: Record<string, Department> = {
  // "bizfin": "Finance",
  // "businessfinance": "Finance",
};

/** Returns the official department name, or UNLISTED if it isn't one. */
export function normalizeOrg(org: string | null | undefined): string {
  if (!org) return UNLISTED;
  const k = key(org);
  return DEPT_LOOKUP.get(k) ?? DEPT_ALIASES[k] ?? UNLISTED;
}

const GENDER_LOOKUP: Record<string, Gender> = {
  m: "Male",
  male: "Male",
  man: "Male",
  men: "Male",
  f: "Female",
  female: "Female",
  woman: "Female",
  women: "Female",
  o: "Other",
  other: "Other",
};

/** Collapses Male / male / M / Man into one value. Returns null if not set. */
export function normalizeGender(gender: string | null | undefined): Gender | null {
  if (!gender) return null;
  return GENDER_LOOKUP[gender.trim().toLowerCase()] ?? "Other";
}
