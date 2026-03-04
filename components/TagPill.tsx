import Link from "next/link";
import { Badge } from "./ui/badge";

interface Props {
  tag: string;
  isHeader?: boolean;
  currentSearch?: string;
  currentFilter?: string;
  variant?: "tag" | "person";
}

export default function TagPill({
  tag,
  isHeader = true,
  currentSearch = "",
  currentFilter = "",
  variant = "tag",
}: Props) {
  const prefix = variant === "tag" ? "#" : "@";
  const token = `${prefix}${tag}`;

  const params = new URLSearchParams();
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

  const badgeVariant = variant === "tag"
    ? (isHeader ? "tag" : "tag-mention")
    : (isHeader ? "person" : "person-mention");

  return (
    <Link href={`/?${params.toString()}`}>
      <Badge variant={badgeVariant} className="cursor-pointer">
        {token}
      </Badge>
    </Link>
  );
}
