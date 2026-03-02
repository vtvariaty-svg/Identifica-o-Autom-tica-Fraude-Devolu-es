export const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
    const url = `${API_URL}${endpoint}`;

    const headers = new Headers(options.headers);
    if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
        headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: "include", // Essential for sending/receiving HTTP-Only cookies
    });

    let data;
    try {
        data = await response.json();
    } catch (err) {
        data = null;
    }

    if (!response.ok) {
        throw new Error(data?.error || "An API error occurred");
    }

    return data;
}
