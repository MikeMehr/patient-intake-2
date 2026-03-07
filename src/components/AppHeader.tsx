"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

const getHeaderMaxWidthClass = (pathname: string): string => {
  // These pages intentionally use a narrower container (max-w-5xl). Match it so the
  // brand aligns with the page gutters rather than the wider dashboard container.
  if (pathname.startsWith("/physician/patients")) return "max-w-5xl";
  if (pathname.startsWith("/physician/view")) return "max-w-5xl";
  return "max-w-7xl";
};

const isAdminOrganizationPage = (pathname: string): boolean =>
  /^\/admin\/organizations\/[^/]+$/.test(pathname);

export function AppHeader() {
  const pathname = usePathname() || "/";
  const shouldHideHeader =
    pathname === "/" ||
    pathname === "/auth/login" ||
    pathname === "/auth/signin" ||
    pathname === "/admin/dashboard" ||
    pathname === "/physician/dashboard" ||
    pathname === "/physician/transcription" ||
    pathname === "/physician/view" ||
    pathname.startsWith("/physician/patients/") ||
    pathname.startsWith("/intake/invite/");

  if (shouldHideHeader) return null;

  const maxWidthClass = getHeaderMaxWidthClass(pathname);
  const useOrganizationHeaderVariant = isAdminOrganizationPage(pathname);

  return (
    <header className="w-full">
      <div
        className={[
          "mx-auto px-4",
          maxWidthClass,
          // Respect iOS safe-area insets while keeping alignment with gutters.
          useOrganizationHeaderVariant
            ? "pt-[calc(env(safe-area-inset-top)+1.75rem)]"
            : "pt-[calc(env(safe-area-inset-top)+1rem)]",
          "pl-[calc(env(safe-area-inset-left)+1rem)]",
          "pr-[calc(env(safe-area-inset-right)+1rem)]",
          useOrganizationHeaderVariant ? "pb-2" : "pb-3",
        ].join(" ")}
      >
        <div className="flex justify-center select-none">
          <Image
            src="/LogoFinal.png"
            alt="Health Assist AI logo"
            width={180}
            height={40}
            className={
              useOrganizationHeaderVariant
                ? "h-[41px] w-[125px] object-contain sm:h-[54px] sm:w-[166px]"
                : "h-[51px] w-[156px] object-contain sm:h-[68px] sm:w-[207px]"
            }
            priority
          />
        </div>
      </div>
    </header>
  );
}

