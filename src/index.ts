import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { logger as _logger } from "./logger";
import { config } from "dotenv";
import { Browser, Page } from "puppeteer";
import Epub from "epub-gen";
import { existsSync, readFileSync, writeFileSync } from "fs";
import express from "express";
import { resolve } from "path";
import crypto from "node:crypto";
import { Logger } from "pino";
import * as ws from "ws";
import { WebSocket } from "ws";

interface Chapter {
    index: number;
    title: string;
    category: string;
    url: string;
    time: number;
}

const getPageAsChapter = async (
    browser: Browser,
    chapterUrl: string,
    logger: Logger
): Promise<{
    result: Epub.Chapter;
    chapter: Chapter;
}> => {
    const page = await browser.newPage();
    await page.goto(chapterUrl);

    const chapter: Partial<Chapter> = {};

    let content = await page.$eval("#HetVerhaal", (el) => {
        return (<HTMLElement>el).innerHTML;
    });

    let date = await page.$eval('[property="article:published_time"]', (el) => {
        return (<HTMLMetaElement>el).content;
    });

    let title = await page.$eval("title", (el) => {
        return (<HTMLTitleElement>el).text.split("|")[0];
    });

    logger.debug(`Extracted content for chapter: ${title}`);
    page.close();

    return {
        result: {
            title: title,
            author: "",
            data: sanitize(content),
        },
        chapter: {
            category: "",
            index: 0,
            time: new Date(date).getTime(),
            title: title,
            url: chapterUrl,
        },
    };
};

/**
 * Santizes html input eg. removes unwanted links and images
 * @param str strint to santize
 * @returns string
 */
const sanitize = (str: string) => {
    str = str.replace(/href="[^"]*"/, 'href=""');
    str = str.replace(/src="[^"]*"/, 'href=""');

    return str;
};

const getSavedEpubs = () => {
    let saved_epubs: {
        [key: string]: Awaited<ReturnType<typeof generateEpub>>;
    };

    try {
        saved_epubs = JSON.parse(
            readFileSync(resolve("tmp", "saved_epubs.json")).toString()
        );
    } catch (error) {
        saved_epubs = {};
    }
    return saved_epubs;
};

const generateEpub = async (
    searchAddress: string,
    hash: string,
    logger: Logger
) => {
    puppeteer.use(StealthPlugin());
    config();

    const browser = await puppeteer.launch({
        headless: process.env?.NODE_ENV === "production" ? "new" : false,
        args: ["--no-sandbox"],
    });

    const page = await browser.newPage();

    await page.setViewport({
        width: 1920,
        height: 1080,
    });

    logger.debug("Browser launched");
    await page.goto(searchAddress).catch(async (err) => {
        browser.close();
        throw err;
    });

    let chapterUrls = await page.$$eval("div.tab .r50l .Overzicht", (els) =>
        els.map((par): string => {
            return par.querySelector<HTMLAnchorElement>("a")?.href ?? "";
        })
    );
    logger.debug(chapterUrls, "Got the following results");

    // Helper function to get page as chapter
    async function mapObjectsToResults(
        objects: string[],
        browser: Browser,
        logger: Logger
    ): Promise<
        {
            result: Epub.Chapter;
            chapter: Chapter;
        }[]
    > {
        return Promise.all(
            objects.map(async (el: string) => {
                let res = await getPageAsChapter(browser, el, logger);
                return res;
            })
        );
    }

    let results = [];

    if (chapterUrls.length > 4) {
        const chunkSize = 4;
        for (let i = 0; i < chapterUrls.length; i += chunkSize) {
            let chunk = chapterUrls.slice(i, i + chunkSize);
            let chunkResults = await mapObjectsToResults(
                chunk,
                browser,
                logger
            );
            results.push(...chunkResults);
        }
    } else {
        results = await mapObjectsToResults(chapterUrls, browser, logger);
    }

    logger.debug(results[0]);

    let title = results[0].chapter.title;
    title = title.slice(0, title.lastIndexOf("-")).trim();
    const option = {
        title: title,
        content: results
            .sort((a, b) => a.chapter.time - b.chapter.time)
            .map((el) => el.result),
    };

    const path = `./tmp/${hash}.epub`;
    await new Epub(option, path).promise;
    logger.info("All done with ebook. ");
    browser.close();

    return {
        title,
        path,
    };
};

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res, next) => {
    res.sendFile(resolve("src", "index.html"));
});

app.use("/die", () => {
    _logger.info("Die and restart has been invoked!");
    if (process.env?.NODE_ENV !== "production") {
        writeFileSync("./src/_.restart", "");
    }
    process.exit();
});

app.post("/post", async (req, res) => {
    const trace_id = crypto
        .createHash("md5")
        .update(
            `${Date.now().toString(16)}${Math.random()
                .toString(16)
                .substring(2, 8)}`
        )
        .digest("hex");
    const hash = crypto.createHash("md5").update(req.body.url).digest("hex");

    const logger = _logger.child({ trace_id });
    res.send({ trace_id, hash });

    await new Promise((resolve, reject) => {
        setInterval(() => {
            if (clients.get(trace_id) !== undefined) {
                resolve(true);
            }
        }, 100);
    });

    logger.info(req.body, "Got post request with body");
    try {
        let saved_epubs = getSavedEpubs();
        if (hash in saved_epubs) {
            logger.info("File already exists, returning now");
            clients.get(trace_id)?.close();
        } else {
            const epub = await generateEpub(req.body.url, hash, logger);
            logger.debug(epub, "Done generating: ");

            writeFileSync(
                resolve("tmp", "saved_epubs.json"),
                JSON.stringify({
                    ...saved_epubs,
                    [hash]: epub,
                })
            );
            saved_epubs = getSavedEpubs();
            clients.get(trace_id)?.close();
        }
    } catch (error) {
        logger.warn(error);
    }
});

app.get("/:file", (req, res) => {
    try {
        let epub = getSavedEpubs()?.[req.params.file];
        if (epub) {
            res.download(resolve(epub.path), epub.title + ".epub");
        } else {
            res.status(404).send("not found");
        }
    } catch (error) {
        res.send("Could not find file xxx");
    }
});

const server = app.listen(3000, () => {
    _logger.info("Server is running");
});

export const websocketServer = new ws.Server({
    noServer: true,
    path: "/websockets",
});

export const clients = new Map<string, WebSocket>();

server.on("upgrade", (request, socket, head) => {
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketServer.emit("connection", websocket, request);
    });
});

websocketServer.on(
    "connection",
    function connection(websocketConnection, connectionRequest) {
        _logger.debug("Got a connection for websockets");

        try {
            // @ts-ignore
            let url = new URL("http://localhost" + connectionRequest.url ?? "");
            let trace_id = url.searchParams.get("trace_id");
            if (trace_id === undefined || trace_id === null) {
                throw "Trace ID has not been supplied";
            } else {
                clients.set(trace_id, websocketConnection);
            }
        } catch (error) {
            _logger.error(error);
            websocketConnection.close();
        }
    }
);
