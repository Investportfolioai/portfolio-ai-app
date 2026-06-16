-- WhatsApp message store for the Twilio webhook receiver.
-- Stores inbound messages matched to deals for surfacing in the Lending view.
--
-- LIVE SENDING requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
-- to be set in the environment. The webhook receiver is functional without them
-- (it accepts all requests in dev mode) but will not send outbound messages.

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_sid text UNIQUE NOT NULL,
  from_number text,
  to_number   text,
  body        text NOT NULL,
  deal_id     uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  direction   text NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  status      text NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_deal_id_idx ON public.whatsapp_messages (deal_id);
CREATE INDEX IF NOT EXISTS whatsapp_messages_received_idx ON public.whatsapp_messages (received_at DESC);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_messages_admin ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_admin ON public.whatsapp_messages
  FOR ALL
  USING (public.is_owner_or_partner())
  WITH CHECK (public.is_owner_or_partner());
