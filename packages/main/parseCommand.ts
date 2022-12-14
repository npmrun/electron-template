import { isPromise } from "@rush/main-tool"
import { ipcMain } from "electron"

const modelsFile = require.context("../main-func", true, /\.ts$/)
const funcs = {}
modelsFile.keys().forEach(key => {
    const res = modelsFile(key)
    const module = res.default || res
    funcs[
        key
            .replace(/(\.\/|\.ts)/g, "")
            .split("/")
            .filter(v => v != "index")
            .join("/")
    ] = module
})

export function parseCommand(command: string): Function | undefined {
    let commands = command.split(".")
    const modulePath = commands.slice(0, -1).join("/")
    let funcName = commands[commands.length - 1]
    const module = funcs[modulePath]
    if (module) {
        const func = module[funcName]
        if (func) {
            const result = func.bind(module)
            if (typeof result === "function") {
                return result
            }
        }
    }
}

/**
 * 超级命令,用字符串直接调用方法
 */
export function initCommands() {
    ipcMain.addListener("command", (event, key, command: string, ...argus) => {
        try {
            let run = parseCommand(command)
            if (run) {
                let result: Promise<any> | any = run(...argus)
                if (isPromise(result)) {
                    result
                        .then((res: any) => {
                            event.reply(key, null, res)
                            event.returnValue = res
                        })
                        .catch((err: Error) => {
                            event.reply(key, err)
                            event.returnValue = null
                        })
                } else {
                    event.reply(key, null, result)
                    event.returnValue = result
                }
            } else {
                event.reply(key, new Error("不存在该命令"))
                event.returnValue = null
            }
        } catch (error) {
            event.reply(key, error)
            event.returnValue = null
        }
    })
}
