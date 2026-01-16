/**
 * Authentication middleware for API routes
 * Protects routes that require physician authentication
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "./auth";

export interface AuthenticatedRequest extends NextRequest {
  physicianId?: string;
  physician?: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    clinicName: string;
  };
}

/**
 * Middleware to require authentication
 * Returns 401 if not authenticated
 */
export async function requireAuth(
  request: NextRequest
): Promise<{ session: any; response?: NextResponse }> {
  const session = await getCurrentSession();

  if (!session) {
    return {
      session: null,
      response: NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      ),
    };
  }

  return { session };
}

/**
 * Middleware wrapper for API routes
 */
export function withAuth(
  handler: (
    request: AuthenticatedRequest,
    context: { session: any }
  ) => Promise<NextResponse>
) {
  return async (request: NextRequest, context: any) => {
    const { session, response } = await requireAuth(request);

    if (response) {
      return response;
    }

    // Add session to request
    (request as AuthenticatedRequest).physicianId = session.physicianId;
    (request as AuthenticatedRequest).physician = {
      id: session.physicianId,
      username: session.username,
      firstName: session.firstName,
      lastName: session.lastName,
      clinicName: session.clinicName,
    };

    return handler(request as AuthenticatedRequest, { session });
  };
}

