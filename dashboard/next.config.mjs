/** @type {import('next').NextConfig} */
// externalDir: the waitlist route imports the shared source list from agent/src.
const nextConfig = { reactStrictMode: true, experimental: { externalDir: true } };
export default nextConfig;
