import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://auronsistem.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeVapidKey(value: string, expectedBytes: number, label: string): string {
  let compact = value.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");
  if (/-----BEGIN|-----END/.test(compact)) {
    throw new Error(label + " must be a raw Base64/Base64URL key, not PEM text.");
  }
  if (expectedBytes === 65 && /^[0-9a-fA-F]{130}$/.test(compact)) {
    let binary = "";
    for (let i = 0; i < compact.length; i += 2) {
      binary += String.fromCharCode(parseInt(compact.slice(i, i + 2), 16));
    }
    compact = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  const normalized = compact.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error(label + " contains characters outside Base64/Base64URL.");
  }
  const base64 = normalized.replace(/-/g, "+").replace(/_/g, "/");
  let decoded: string;
  try {
    decoded = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  } catch {
    throw new Error(label + " is not valid Base64.");
  }
  if (decoded.length !== expectedBytes) {
    throw new Error(label + " must decode to exactly " + expectedBytes + " bytes.");
  }
  if (expectedBytes === 65 && decoded.charCodeAt(0) !== 4) {
    throw new Error(label + " is not an uncompressed P-256 public key.");
  }
  return normalized;
}

Deno.serve(async (req: Request) => {
  let stage = "request";
  try {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  stage = "read-server-configuration";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicRaw = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateRaw = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@aureon.app";
  if (!supabaseUrl || !serviceKey) return response({ error: "Server configuration missing" }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return response({ error: "Sign in required" }, 401);

  stage = "authenticate-user";
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  const user = userResult?.user;
  if (userError || !user) return response({ error: "Invalid session" }, 401);

  stage = "parse-request";
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return response({ error: "Invalid JSON" }, 400); }

  if (body.action === "config") {
    if (!vapidPublicRaw) return response({ error: "Push notifications are not configured yet" }, 503);
    try {
      return response({ publicKey: normalizeVapidKey(vapidPublicRaw, 65, "VAPID_PUBLIC_KEY") });
    } catch (error) {
      console.error("call-push: invalid VAPID public key format", error);
      return response({ error: "VAPID_PUBLIC_KEY must be a valid 65-byte P-256 key in Base64 or Base64URL format." }, 500);
    }
  }

  if (body.action === "register") {
    stage = "register-push-subscription";
    const supplied = body.subscription;
    if (!supplied || typeof supplied !== "object" ||
        typeof (supplied as Record<string, unknown>).endpoint !== "string" ||
        !(supplied as Record<string, unknown>).endpoint ||
        typeof (supplied as Record<string, unknown>).keys !== "object" ||
        !(supplied as Record<string, unknown>).keys) {
      return response({ error: "Invalid push subscription" }, 400);
    }
    const serialized = supplied as { endpoint: string; keys: { p256dh?: string; auth?: string }; [key: string]: unknown };
    if (!serialized.keys.p256dh || !serialized.keys.auth) {
      return response({ error: "Incomplete push subscription keys" }, 400);
    }
    const { error: saveError } = await admin.from("push_subscriptions").upsert({
      user_id: user.id,
      endpoint: serialized.endpoint,
      subscription: serialized,
      updated_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    if (saveError) {
      console.error("call-push: subscription registration failed", saveError);
      return response({ error: "Could not link this device to the signed-in account" }, 500);
    }
    return response({ registered: true, userId: user.id });
  }


  if (body.action === "friend-request") {
    stage = "prepare-friend-request-push";
    if (!vapidPublicRaw || !vapidPrivateRaw) {
      return response({ error: "Push notifications are not configured yet" }, 503);
    }
    const recipientId = typeof body.recipientId === "string" ? body.recipientId : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    if (!recipientId || !requestId || recipientId === user.id) {
      return response({ error: "Invalid friend request notification" }, 400);
    }

    stage = "verify-friend-request";
    const { data: request, error: requestError } = await admin
      .from("friend_requests")
      .select("id,sender_id,recipient_id,status")
      .eq("id", requestId)
      .eq("sender_id", user.id)
      .eq("recipient_id", recipientId)
      .eq("status", "pending")
      .maybeSingle();
    if (requestError || !request) {
      return response({ error: "Friend request not found or not permitted" }, 403);
    }

    const [{ data: profile }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
      admin.from("profiles").select("display_name,username").eq("id", user.id).maybeSingle(),
      admin.from("push_subscriptions").select("id,subscription").eq("user_id", recipientId)
    ]);
    if (subscriptionError) return response({ error: "Could not load friend request recipient" }, 500);
    if (!subscriptions?.length) return response({ sent: 0, total: 0, message: "Recipient has no push subscriptions" });

    try {
      const vapidPublic = normalizeVapidKey(vapidPublicRaw, 65, "VAPID_PUBLIC_KEY");
      const vapidPrivate = normalizeVapidKey(vapidPrivateRaw, 32, "VAPID_PRIVATE_KEY");
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    } catch (error) {
      console.error("call-push: invalid VAPID configuration for friend request", error);
      return response({ error: "Invalid VAPID key configuration." }, 500);
    }

    const senderName = profile?.display_name?.trim() && profile.display_name.toLowerCase() !== "jugador"
      ? profile.display_name.trim()
      : profile?.username?.trim() || "Un usuario de AUREON";
    stage = "send-friend-request-push";
    let sent = 0;
    const staleIds: string[] = [];
    await Promise.all(subscriptions.map(async (row: { id: string; subscription: unknown }) => {
      try {
        await webpush.sendNotification(row.subscription as any, JSON.stringify({
          title: "Nueva solicitud de amistad · AUREON",
          body: senderName + " quiere ser tu amigo. Toca para revisar la solicitud.",
          tag: "aureon-friend-request-" + requestId,
          renotify: true,
          type: "friend-request",
          requestId,
          url: "./?openSettings=friend-requests"
        }), { TTL: 86400, urgency: "normal" });
        sent++;
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) staleIds.push(row.id);
        console.error("Friend request push delivery failed", statusCode || "unknown",
          error instanceof Error ? error.message : String(error));
      }
    }));
    if (staleIds.length) await admin.from("push_subscriptions").delete().in("id", staleIds);
    return response({ sent, total: subscriptions.length });
  }

  if (body.action === "message" || body.action === "group-message") {
    stage = "prepare-message-push";
    if (!vapidPublicRaw || !vapidPrivateRaw) return response({ error: "Push notifications are not configured yet" }, 503);
    let vapidPublic: string;
    let vapidPrivate: string;
    try {
      vapidPublic = normalizeVapidKey(vapidPublicRaw, 65, "VAPID_PUBLIC_KEY");
      vapidPrivate = normalizeVapidKey(vapidPrivateRaw, 32, "VAPID_PRIVATE_KEY");
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    } catch (error) {
      console.error("call-push: invalid VAPID configuration for message", error);
      return response({ error: "Invalid VAPID key configuration. Check that the public key is 65 bytes and the private key is 32 bytes." }, 500);
    }

    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    if (!messageId) return response({ error: "Message ID is required" }, 400);

    let recipientIds: string[] = [];
    let title = "Nuevo mensaje · AUREON";
    let preview = "Tienes un mensaje nuevo.";
    const { data: senderProfile } = await admin
      .from("profiles").select("display_name").eq("id", user.id).maybeSingle();
    const senderName = senderProfile?.display_name?.trim() || "Un usuario de AUREON";

    if (body.action === "message") {
      const { data: message, error: messageError } = await admin
        .from("messages").select("id,conversation_id,sender_id,body")
        .eq("id", messageId).maybeSingle();
      if (messageError || !message || message.sender_id !== user.id) {
        return response({ error: "Message not found or not permitted" }, 403);
      }
      const { data: conversation, error: conversationError } = await admin
        .from("conversations").select("participant_one,participant_two")
        .eq("id", message.conversation_id).maybeSingle();
      if (conversationError || !conversation ||
          ![conversation.participant_one, conversation.participant_two].includes(user.id)) {
        return response({ error: "Conversation not found or not permitted" }, 403);
      }
      recipientIds = [conversation.participant_one, conversation.participant_two].filter((id: string) => id !== user.id);
      preview = String(message.body || "Tienes un mensaje nuevo.").slice(0, 120);
      title = senderName;
      preview = ": " + preview;
    } else {
      const { data: message, error: messageError } = await admin
        .from("chat_group_messages").select("id,group_id,sender_id,body")
        .eq("id", messageId).maybeSingle();
      if (messageError || !message || message.sender_id !== user.id) {
        return response({ error: "Group message not found or not permitted" }, 403);
      }
      const [{ data: members }, { data: group }] = await Promise.all([
        admin.from("chat_group_members").select("user_id").eq("group_id", message.group_id),
        admin.from("chat_groups").select("name").eq("id", message.group_id).maybeSingle()
      ]);
      const memberIds = (members || []).map((item: { user_id: string }) => item.user_id);
      if (!memberIds.includes(user.id)) return response({ error: "Group membership required" }, 403);
      recipientIds = memberIds.filter((id: string) => id !== user.id);
      preview = String(message.body || "Tienes un mensaje nuevo.").slice(0, 120);
      title = senderName + " · " + (group?.name || "Grupo AUREON");
      preview = ": " + preview;
    }

    if (preview.startsWith(": AUREON_GIF:") || preview.startsWith(": AUREON_MEDIA_FILE:")) {
      preview = ": Te enviaron un GIF o una imagen.";
    } else if (preview.startsWith(": AUREON_STICKER:")) {
      preview = ": Te enviaron un sticker.";
    }
    if (!recipientIds.length) return response({ sent: 0, message: "No recipients" });
    stage = "load-message-recipients";
    const { data: subscriptions, error: subscriptionError } = await admin
      .from("push_subscriptions").select("id,user_id,subscription").in("user_id", recipientIds);
    if (subscriptionError) return response({ error: "Could not load push subscriptions" }, 500);
    if (!subscriptions?.length) return response({ sent: 0, message: "Recipients have no push subscriptions" });

    stage = "send-message-push";
    let sent = 0;
    const staleIds: string[] = [];
    await Promise.all(subscriptions.map(async (row: { id: string; subscription: unknown }) => {
      try {
        await webpush.sendNotification(row.subscription as any, JSON.stringify({
          title,
          body: preview,
          tag: "aureon-message-" + messageId,
          renotify: true,
          type: "message",
          url: "./"
        }), { TTL: 86400, urgency: "normal" });
        sent++;
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) staleIds.push(row.id);
        console.error("Message push delivery failed", statusCode || "unknown", error instanceof Error ? error.message : String(error));
      }
    }));
    if (staleIds.length) await admin.from("push_subscriptions").delete().in("id", staleIds);
    return response({ sent, total: subscriptions.length });
  }


  if (body.action === "group-call") {
    stage = "prepare-group-call-push";
    if (!vapidPublicRaw || !vapidPrivateRaw) return response({ error: "Push notifications are not configured yet" }, 503);

    const groupId = typeof body.groupId === "string" ? body.groupId : "";
    const recipientId = typeof body.recipientId === "string" ? body.recipientId : "";
    const callId = typeof body.callId === "string" ? body.callId : "";
    const video = Boolean(body.video);
    if (!groupId || !recipientId || !callId || recipientId === user.id) {
      return response({ error: "Invalid group call details" }, 400);
    }

    stage = "verify-group-call-membership";
    const [{ data: members, error: membersError }, { data: invite, error: inviteError }] = await Promise.all([
      admin.from("chat_group_members").select("user_id").eq("group_id", groupId),
      admin.from("chat_group_call_signals")
        .select("id")
        .eq("group_id", groupId)
        .eq("call_id", callId)
        .eq("sender_id", user.id)
        .eq("recipient_id", recipientId)
        .eq("signal_type", "invite")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);
    if (membersError || inviteError || !invite) {
      return response({ error: "No matching group call invitation found" }, 403);
    }
    const memberIds = (members || []).map((item: { user_id: string }) => item.user_id);
    if (!memberIds.includes(user.id) || !memberIds.includes(recipientId)) {
      return response({ error: "Both sender and recipient must belong to the group" }, 403);
    }

    stage = "load-group-call-recipient";
    const [{ data: group }, { data: profile }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
      admin.from("chat_groups").select("name").eq("id", groupId).maybeSingle(),
      admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      admin.from("push_subscriptions").select("id,subscription").eq("user_id", recipientId)
    ]);
    if (subscriptionError) return response({ error: "Could not load group call push subscriptions" }, 500);
    if (!subscriptions?.length) return response({ sent: 0, message: "Recipient has no push subscriptions" });

    try {
      const vapidPublic = normalizeVapidKey(vapidPublicRaw, 65, "VAPID_PUBLIC_KEY");
      const vapidPrivate = normalizeVapidKey(vapidPrivateRaw, 32, "VAPID_PRIVATE_KEY");
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    } catch (error) {
      console.error("call-push: invalid VAPID configuration for group call", error);
      return response({ error: "Invalid VAPID key configuration. Check that the public key is 65 bytes and the private key is 32 bytes." }, 500);
    }

    const callerName = profile?.display_name?.trim() || "Un usuario de AUREON";
    const groupName = group?.name || "grupo AUREON";
    stage = "send-group-call-push";
    let sent = 0;
    const staleIds: string[] = [];
    await Promise.all(subscriptions.map(async (row: { id: string; subscription: unknown }) => {
      try {
        await webpush.sendNotification(row.subscription as any, JSON.stringify({
          title: video ? "Videollamada grupal · AUREON" : "Llamada grupal · AUREON",
          body: callerName + " te invita al grupo " + groupName + ".",
          tag: "aureon-group-call-" + callId,
          renotify: true,
          type: "group-call",
          callId,
          groupId,
          url: "./"
        }), { TTL: 60, urgency: "high" });
        sent++;
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) staleIds.push(row.id);
        console.error("Group call push delivery failed", statusCode || "unknown", error instanceof Error ? error.message : String(error));
      }
    }));
    if (staleIds.length) await admin.from("push_subscriptions").delete().in("id", staleIds);
    return response({ sent, total: subscriptions.length });
  }

  stage = "prepare-call-push";
  if (body.action !== "call") return response({ error: "Unsupported action" }, 400);
  if (!vapidPublicRaw || !vapidPrivateRaw) return response({ error: "Push notifications are not configured yet" }, 503);

  const recipientId = typeof body.recipientId === "string" ? body.recipientId : "";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  const callId = typeof body.callId === "string" ? body.callId : "";
  const video = Boolean(body.video);
  if (!recipientId || !conversationId || !callId || recipientId === user.id) {
    return response({ error: "Invalid call details" }, 400);
  }

  const { data: conversation, error: conversationError } = await admin
    .from("conversations")
    .select("participant_one,participant_two")
    .eq("id", conversationId)
    .maybeSingle();
  if (conversationError || !conversation ||
      ![conversation.participant_one, conversation.participant_two].includes(user.id) ||
      ![conversation.participant_one, conversation.participant_two].includes(recipientId)) {
    return response({ error: "Conversation not found or not permitted" }, 403);
  }

  const { data: invite, error: inviteError } = await admin
    .from("call_signals")
    .select("id")
    .eq("call_id", callId)
    .eq("sender_id", user.id)
    .eq("recipient_id", recipientId)
    .eq("conversation_id", conversationId)
    .eq("signal_type", "invite")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inviteError || !invite) return response({ error: "No matching call invite found" }, 403);

  stage = "load-call-recipient";
  const [{ data: profile }, { data: subscriptions }] = await Promise.all([
    admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    admin.from("push_subscriptions").select("id,subscription").eq("user_id", recipientId),
  ]);
  const callerName = profile?.display_name?.trim() || "Un usuario de AUREON";
  if (!subscriptions?.length) return response({ sent: 0, message: "Recipient has no push subscriptions" });

  try {
    const vapidPublic = normalizeVapidKey(vapidPublicRaw, 65, "VAPID_PUBLIC_KEY");
    const vapidPrivate = normalizeVapidKey(vapidPrivateRaw, 32, "VAPID_PRIVATE_KEY");
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  } catch (error) {
    console.error("call-push: invalid VAPID configuration for call", error);
    return response({ error: "Invalid VAPID key configuration. Check that the public key is 65 bytes and the private key is 32 bytes." }, 500);
  }

  stage = "send-call-push";
  let sent = 0;
  const staleIds: string[] = [];
  await Promise.all(subscriptions.map(async (row: { id: string; subscription: unknown }) => {
    try {
      await webpush.sendNotification(row.subscription as any, JSON.stringify({
        title: video ? "Videollamada entrante · AUREON" : "Llamada entrante · AUREON",
        body: callerName + " te está llamando.",
        tag: "aureon-call-" + callId,
        renotify: true,
        type: "call",
        callId,
        url: "./",
      }), { TTL: 60, urgency: "high" });
      sent++;
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) staleIds.push(row.id);
      console.error("Push delivery failed", statusCode || "unknown", error instanceof Error ? error.message : String(error));
    }
  }));
  if (staleIds.length) await admin.from("push_subscriptions").delete().in("id", staleIds);
  return response({ sent, total: subscriptions.length });
  } catch (error) {
    console.error("call-push unhandled failure at " + stage, error);
    return response({ error: "Push delivery failed", stage }, 500);
  }
});
