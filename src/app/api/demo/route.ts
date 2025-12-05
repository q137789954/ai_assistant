import { getDemoPayload, handleDemoPost } from "@/server/demoService";
import { withGlobalResponse } from "@/server/middleware/responseFormatter";

export async function GET() {
  return withGlobalResponse(() => getDemoPayload());
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  return withGlobalResponse(() => handleDemoPost(payload));
}
