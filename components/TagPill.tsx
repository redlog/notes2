import Link from "next/link";

interface Props {
  tag: string;
  isHeader?: boolean;
  currentSearch?: string;
  currentFilter?: string;
  currentProject?: string;
  variant?: "tag" | "person";
}

export default function TagPill({
  tag,
  isHeader = true,
  currentSearch = "",
  currentFilter = "",
  currentProject = "",
  variant = "tag",
}: Props) {
  const prefix = variant === "tag" ? "#" : "@";
  const token = `${prefix}${tag}`;

  // Build URL that adds this tag/person to the filter
  const params = new URLSearchParams();
  if (currentProject) params.set("project", currentProject);
  if (currentSearch) params.set("search", currentSearch);
  const existingTokens = currentFilter
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!existingTokens.includes(token)) {
    const newFilter = [...existingTokens, token].join(" ");
    params.set("filter", newFilter);
  } else if (currentFilter) {
    params.set("filter", currentFilter);
  }

  const color =
    variant === "tag"
      ? isHeader
        ? "bg-blue-100 text-blue-800"
        : "bg-blue-50 text-blue-600"
      : isHeader
      ? "bg-purple-100 text-purple-800"
      : "bg-purple-50 text-purple-600";

  return (
    <Link
      href={`/?${params.toString()}`}
      className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${color} hover:opacity-80 transition`}
    >
      {token}
    </Link>
  );
}
