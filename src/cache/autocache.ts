import { GameCacheLoader } from "./sqlite";
import { WasmGameCacheLoader } from "./sqlitewasm";
import { ClassicFileSource } from "./classicloader";
import { LegacyFileSource } from "./legacyloader"; // Add this import
import { CLIScriptFS, ScriptFS } from "../scriptrunner";
import { CacheOpts } from "../cliparser";
import { WebFsScriptFS } from "../viewer/scriptsui";

export async function selectFsCache(fs: ScriptFS, opts?: CacheOpts) {
    let files = await fs.readDir(".");

    let jcachecount = 0;
    let datcount = 0;
    let dat2count = 0;
    let jagcount = 0;
    let idxcount = 0; // Add this

    for (let file of files) {
        let ext = file.name.match(/\.(\w+)$/);
        if (ext?.[1] == "jcache") { jcachecount++; }
        if (ext?.[1] == "dat2") { dat2count++; }
        if (ext?.[1] == "dat") { datcount++; }
        if (ext?.[1] == "jag") { jagcount++; }
        // Check for idx files
        if (file.name.match(/^main_file_cache\.idx\d+$/)) { idxcount++; }
    }

    let maxcount = Math.max(jcachecount, datcount, dat2count, jagcount, idxcount);
    if (maxcount == 0) { throw new Error("no cache files found in selected directory"); }

    if (maxcount == jcachecount) {
        if (fs instanceof CLIScriptFS) {
            return new GameCacheLoader(fs.dir, !!opts?.writable);
        } else if (fs instanceof WebFsScriptFS) {
            if (!fs.roothandle) { throw new Error("need fs with hard disk backing"); }
            let cache = new WasmGameCacheLoader();
            await cache.giveFsDirectory(fs.roothandle);
            return cache;
        }
    }

    // Handle legacy .dat2 + .idx* format
    if (maxcount == idxcount && dat2count > 0) {
        if (fs instanceof CLIScriptFS) {
            // Look for CS2 opcode mapping file
            const cs2MappingFile = "rs2_727.ini"; // or make this configurable
            return new LegacyFileSource(fs.dir, cs2MappingFile);
        } else {
            throw new Error("Legacy cache format requires filesystem access");
        }
    }

    if (maxcount == datcount) {
        //TODO
    }
    if (maxcount == dat2count) {
        //TODO - this is now handled above with idxcount
    }
    if (maxcount == jagcount) {
        return await ClassicFileSource.create(fs);
    }
    throw new Error("couldn't detect cache type");
}