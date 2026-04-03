"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Clinic = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
};

export default function BookingLandingPage() {
  const router = useRouter();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/booking/clinics")
      .then((r) => r.json())
      .then((data) => {
        const list: Clinic[] = data.clinics ?? [];
        if (list.length === 1) {
          router.replace(`/booking/${list[0].slug}`);
          return;
        }
        setClinics(list);
        setLoading(false);
      })
      .catch(() => {
        setError("Unable to load clinic list. Please try again.");
        setLoading(false);
      });
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (clinics.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">No clinics are currently accepting online bookings.</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Book an Appointment</h1>
        <p className="text-gray-500 mb-8">Select a clinic to get started.</p>
        <div className="space-y-4">
          {clinics.map((clinic) => (
            <button
              key={clinic.id}
              onClick={() => router.push(`/booking/${clinic.slug}`)}
              className="w-full text-left bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-500 hover:shadow transition"
            >
              <p className="font-semibold text-gray-900 text-lg">{clinic.name}</p>
              {clinic.address && (
                <p className="text-gray-500 text-sm mt-1">{clinic.address}</p>
              )}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
