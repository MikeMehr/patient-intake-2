"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

interface PhysicianInfo {
  id: string;
  firstName: string;
  lastName: string;
  clinicName: string;
}

// Dynamically import the Home component (intake form) to avoid SSR issues
const IntakeForm = dynamic(() => import("@/app/page"), { 
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="text-center">
        <p className="text-slate-600">Loading intake form...</p>
      </div>
    </div>
  )
});

export default function PhysicianIntakePage() {
  const params = useParams();
  const slug = params.slug as string;
  const [physician, setPhysician] = useState<PhysicianInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [physicianIdSet, setPhysicianIdSet] = useState(false);

  useEffect(() => {
    if (!slug) return;

    // Fetch physician info by slug
    fetch(`/api/physicians/by-slug/${slug}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Physician not found");
        }
        return res.json();
      })
      .then((data) => {
        setPhysician(data.physician);
        
        // Store physicianId in sessionStorage so the form can access it
        // MUST be set before form loads
        if (data.physician && typeof window !== "undefined") {
          sessionStorage.setItem("physicianId", data.physician.id);
          sessionStorage.setItem("physicianName", `${data.physician.firstName} ${data.physician.lastName}`);
          sessionStorage.setItem("clinicName", data.physician.clinicName);
          console.log("[intake/[slug]] Set physicianId in sessionStorage:", data.physician.id);
          setPhysicianIdSet(true);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load physician information");
        setLoading(false);
      });
  }, [slug]);

  if (loading || !physicianIdSet) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="text-center">
          <p className="text-slate-600">Loading intake form...</p>
        </div>
      </div>
    );
  }

  if (error || !physician) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="text-center">
          <p className="text-red-600">{error || "Physician not found"}</p>
          <p className="mt-2 text-sm text-slate-600">
            Please check the link provided by your physician.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Physician Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-xl font-semibold text-slate-900">
            {physician.firstName} {physician.lastName}
          </h1>
          <p className="text-sm text-slate-600">{physician.clinicName}</p>
        </div>
      </div>
      {/* Render the intake form - only after physicianId is set in sessionStorage */}
      <IntakeForm />
    </div>
  );
}
