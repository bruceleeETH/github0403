export class HttpError extends Error {
    constructor(statusCode, message, payload = {}) {
        super(message);
        this.name = "HttpError";
        this.statusCode = statusCode;
        this.payload = payload;
    }
}

export function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload, null, 2));
}

export function sendText(res, statusCode, payload, contentType = "text/plain; charset=utf-8") {
    res.writeHead(statusCode, { "Content-Type": contentType });
    res.end(payload);
}

export function methodNotAllowed(res, allowedMethods = []) {
    const allow = allowedMethods.join(", ");
    res.writeHead(405, {
        "Content-Type": "application/json; charset=utf-8",
        ...(allow ? { Allow: allow } : {}),
    });
    res.end(JSON.stringify({ error: "请求方法不支持", allowed_methods: allowedMethods }, null, 2));
}

export function getErrorPayload(error, fallbackMessage = "服务异常") {
    if (error instanceof HttpError) {
        return {
            statusCode: error.statusCode,
            payload: {
                error: error.message || fallbackMessage,
                ...error.payload,
            },
        };
    }

    return {
        statusCode: 500,
        payload: { error: error?.message || fallbackMessage },
    };
}

export function readJsonBody(req, options = {}) {
    const maxBytes = options.maxBytes || 1024 * 1024;

    return new Promise((resolve, reject) => {
        let body = "";
        let rejected = false;

        req.on("data", (chunk) => {
            if (rejected) return;
            body += chunk;
            if (Buffer.byteLength(body) > maxBytes) {
                rejected = true;
                reject(new HttpError(413, "请求体过大", { max_bytes: maxBytes }));
                req.destroy();
            }
        });

        req.on("end", () => {
            if (rejected) return;
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(new HttpError(400, "无效的 JSON 请求体"));
            }
        });

        req.on("error", (error) => {
            if (!rejected) reject(error);
        });
    });
}

export function requireMethod(req, res, allowedMethods) {
    if (allowedMethods.includes(req.method)) return true;
    methodNotAllowed(res, allowedMethods);
    return false;
}
