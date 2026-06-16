import { createFileRoute } from "@tanstack/react-router";
import NeonStack from "@/components/NeonStack";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Neon Stack — Falling Block Puzzle" },
      { name: "description", content: "Offline, ad-free neon block puzzle. Pure skill. One more run." },
      { property: "og:title", content: "Neon Stack" },
      { property: "og:description", content: "Offline, ad-free neon block puzzle. Pure skill." },
    ],
  }),
  component: Index,
});

function Index() {
  return <NeonStack />;
}
