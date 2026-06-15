import { LivingCanvasHero } from "@/components/landing/living-canvas-hero";

export default function SignUpPage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-base font-geist">
      {/* Ambient base gradient (visible behind the canvas + mobile fallback) */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(120% 120% at 18% 0%, #15161c 0%, #0c0c10 45%, #07070a 100%)",
        }}
      />

      {/* Living canvas hero with the sign-up form as a node */}
      <main className="relative flex-1">
        <LivingCanvasHero mode="sign-up" />
      </main>
    </div>
  );
}
