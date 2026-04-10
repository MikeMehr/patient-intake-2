/**
 * GET /api/physician/assistants - List assistants for the current provider
 * POST /api/physician/assistants - Create a new assistant for the current provider
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentSession, validatePassword, hashPassword } from "@/lib/auth";
import { isAssistantSession } from "@/lib/auth-helpers";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isAssistantSession(session)) {
      return NextResponse.json({ error: "Assistants cannot manage other assistants" }, { status: 403 });
    }

    const result = await query<{
      id: string;
      username: string;
      email: string | null;
      first_name: string;
      last_name: string;
      is_active: boolean;
      created_at: string;
      last_login: string | null;
    }>(
      `SELECT id, username, email, first_name, last_name, is_active, created_at, last_login
       FROM provider_assistants
       WHERE physician_id = $1
       ORDER BY created_at ASC`,
      [session.userId]
    );

    return NextResponse.json({
      assistants: result.rows.map((a) => ({
        id: a.id,
        username: a.username,
        email: a.email,
        firstName: a.first_name,
        lastName: a.last_name,
        isActive: a.is_active,
        createdAt: a.created_at,
        lastLogin: a.last_login,
      })),
    });
  } catch (error) {
    console.error("[physician/assistants GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isAssistantSession(session)) {
      return NextResponse.json({ error: "Assistants cannot create other assistants" }, { status: 403 });
    }

    const body = await request.json();
    const { firstName, lastName, username, password, email } = body;

    if (!firstName || !lastName || !username || !password) {
      return NextResponse.json(
        { error: "firstName, lastName, username, and password are required" },
        { status: 400 }
      );
    }

    // Validate password complexity
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
    }

    // Check username uniqueness across provider_assistants
    const existingUsername = await query(
      `SELECT id FROM provider_assistants WHERE username = $1`,
      [username.toLowerCase().trim()]
    );
    if (existingUsername.rows.length > 0) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }

    // Check email uniqueness (if provided)
    if (email) {
      const existingEmail = await query(
        `SELECT id FROM provider_assistants WHERE email = $1`,
        [email.toLowerCase().trim()]
      );
      if (existingEmail.rows.length > 0) {
        return NextResponse.json({ error: "Email already in use" }, { status: 409 });
      }
    }

    const passwordHash = await hashPassword(password);

    const result = await query<{ id: string; username: string }>(
      `INSERT INTO provider_assistants (physician_id, username, password_hash, email, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username`,
      [
        session.userId,
        username.toLowerCase().trim(),
        passwordHash,
        email ? email.toLowerCase().trim() : null,
        firstName.trim(),
        lastName.trim(),
      ]
    );

    return NextResponse.json({ assistant: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("[physician/assistants POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
