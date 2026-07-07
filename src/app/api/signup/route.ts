import { supabaseClient } from "@/app/lib/supabase"

interface SignupRequest {
    firstname: string;
    lastname: string;
    username: string;
    password: string;
}

export async function POST(req: Request): Promise<Response> {
    const { firstname, lastname, username, password }: SignupRequest = await req.json();
    const { error } = await supabaseClient.from('users').insert({ firstname, lastname, username, password });
    if (error) {
        console.log(error)
        return new Response('Error in signup !', { status: 400 });
    }
    return new Response(JSON.stringify({ username }), { status: 200 });
}
