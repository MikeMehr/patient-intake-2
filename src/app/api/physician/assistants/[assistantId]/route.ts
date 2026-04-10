/**
 * PUT /api/physician/assistants/[assistantId] - Update an assistant
 * DELETE /api/physician/assistants/[assistantId] - Delete an assistant
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentSession, validatePassword, hashPassword } from "@/lib/auth";
import { isAssistantSession } from "@/lib/auth-helpers";

type Params = { params: Promise<{ assistantId: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isAssistantSession(session)) {
      return NextResponse.json({ error: "Assistants cannot manage other assistants" }, { status: 403 });
    }

    const { assistantId } = await params;

    // Verify ownership
    const existing = await query<{ id: string; physician_id: string }>(
      `SELECT id, physician_id FROM provider_assistants WHERE id = $1`,
      [assistantId]
    );
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "Assistant not found" }, { status: 404 });
    }
    if (existing.rows[0].physician_id !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { firstName, lastName, email, password, isActive } = body;

    // Build update fields dynamically
    const updates: string[] = ["updated_at = NOW()"];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (firstName !== undefined) {
      updates.push(`first_name = $${paramIdx++}`);
      values.push(firstName.trim());
    }
    if (lastName !== undefined) {
      updates.push(`last_name = $${paramIdx++}`);
      values.push(lastName.trim());
    }
    if (email !== undefined) {
      updates.push(`email = $${paramIdx++}`);
      values.push(email ? email.toLowerCase().trim() : null);
    }
    if (isActive !== undefined) {
      updates.push(`is_active = $${paramIdx++}`);
      values.push(Boolean(isActive));
    }
    if (password !== undefined) {
      const passwordCheck = validatePassword(password);
      if (!passwordCheck.valid) {
        return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
      }
      const passwordHash = await hashPassword(password);
      updates.push(`password_hash = $${paramIdx++}`);
      values.push(passwordHash);
    }

    values.push(assistantId);
    await query(
      `UPDATE provider_assistants SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[physician/assistants PUT]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isAssistantSession(session)) {
      return NextResponse.json({ error: "Assistants cannot manage other assistants" }, { status: 403 });
    }

    const { assistantId } = await params;

    // Verify ownership
    const existing = await query<{ id: string; physician_id: string }>(
      `SELECT id, physician_id FROM provider_assistants WHERE id = $1`,
      [assistantId]
    );
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "Assistant not found" }, { status: 404 });
    }
    if (existing.rows[0].physician_id !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await query(`DELETE FROM provider_assistants WHERE id = $1`, [assistantId]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[physician/assistants DELETE]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
