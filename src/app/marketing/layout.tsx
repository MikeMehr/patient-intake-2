import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Health Assist AI - Made by Physicians, for Physicians",
  description:
    "Reduce physician workload and increase productivity with HIPAA-compliant AI-powered patient intake solutions. Designed from bottom to top for patient confidentiality.",
  openGraph: {
    title: "Health Assist AI - Made by Physicians, for Physicians",
    description:
      "Reduce physician workload and increase productivity with HIPAA-compliant AI-powered patient intake solutions.",
    type: "website",
  },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

























