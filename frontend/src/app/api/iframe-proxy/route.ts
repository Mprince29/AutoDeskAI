import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        // Mimic a standard browser to avoid being blocked by simple bot protection
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!response.ok) {
      return new NextResponse(`Failed to fetch: ${response.statusText}`, { status: response.status });
    }

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("text/html")) {
      return new NextResponse(response.body, {
        status: 200,
        headers: { "Content-Type": contentType || "application/octet-stream" },
      });
    }

    let html = await response.text();

    // Inject a <base> tag so relative CSS/JS/Image links still load from the original website
    const baseUrl = new URL(url).origin;
    if (html.toLowerCase().includes("<head>")) {
      html = html.replace(/<head>/i, `<head><base href="${baseUrl}/">`);
    } else {
      html = `<head><base href="${baseUrl}/"></head>` + html;
    }

    // Return the HTML completely stripped of X-Frame-Options and Content-Security-Policy headers!
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // We explicitly omit X-Frame-Options and Content-Security-Policy
      },
    });
  } catch (error: any) {
    console.error("Iframe proxy error:", error);
    return new NextResponse(`Error fetching URL: ${error.message}`, { status: 500 });
  }
}
