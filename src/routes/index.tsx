import { createFileRoute } from "@tanstack/react-router";
import NeonStack from "@/components/NeonStack";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HETRIS — Falling Block Puzzle" },
      { name: "description", content: "HETRIS by Haider. Offline, ad-free falling-block puzzle. Pure skill." },
      { property: "og:title", content: "HETRIS" },
      { property: "og:description", content: "HETRIS by Haider. Offline, ad-free falling-block puzzle." },
    ],
  }),
  component: Index,
});

function Index() {
  return <NeonStack />;
}
