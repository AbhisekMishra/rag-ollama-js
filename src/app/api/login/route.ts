import { supabaseClient } from "@/app/lib/supabase"

interface LoginRequest {
    username: string;
    password: string;
}

export async function POST(req: Request): Promise<Response> {
    const { username, password }: LoginRequest = await req.json();
    const { error } = await supabaseClient.rpc('verify_password', { input_username: username, input_password: password });
    if (error) {
        console.log(error)
        return new Response('Error in login !', { status: 400 });
    }

    return new Response(JSON.stringify({ username }), { status: 200 });
}
