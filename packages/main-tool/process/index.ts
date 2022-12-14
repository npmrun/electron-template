import { ChildProcessWithoutNullStreams } from "child_process"
import { execa } from "./execa"
import { forkFn } from "./fork"
import kill from "./kill"
import { iGetInnerText } from "@rush/common/util"
import { EProcessStatus } from "@rush/common/process"
import { broadcast } from "@rush/main-tool"
import { checkCommand } from "./script"

interface IProcessChild {
    key: number | string
    command: string
    execCommand: {
        cmd: string
        argu: string[]
    }
    status: EProcessStatus
    log: string[]
    instance: null | ChildProcessWithoutNullStreams
}

class ProcessManager {
    private constructor() {}
    static instance: null | ProcessManager = null
    static getInstance() {
        if (ProcessManager.instance == null) {
            ProcessManager.instance = new ProcessManager()
        }
        return ProcessManager.instance
    }

    private _processlist: IProcessChild[] = []

    getList() {
        let array = this._processlist.map(v => {
            let obj = Object.assign({}, v) as any
            delete obj.instance
            return obj
        })
        return array
    }

    send(key: string | number, status: EProcessStatus, message?: string) {
        broadcast("event:process", { key: key, status: status, message: message })
    }

    getProcess(key: string | number) {
        let array = this._processlist.filter(v => {
            return v.key === key
        })
        let instance = array[0]
        if (instance) {
            let obj = Object.assign({}, instance) as any
            delete obj.instance
            return obj
        }
    }

    async run(command: string){
        const commandArray = command.split(" ")
        let execCommand = checkCommand(commandArray[0])
        let exec = forkFn
        if(!execCommand){
            exec = execa
            execCommand = commandArray[0]
        }
        let args = commandArray.slice(1)
        let logs = []
        await (async () => {
            await (new Promise((resolve)=>{
                exec(execCommand, args, (err, data, isComplete) => {
                    if (isComplete) {
                        resolve(null)
                        return
                    }
                    if (err) {
                        logs.push(err)
                    } else {
                        logs.push(iGetInnerText(data))
                    }
                })
            }))
        })()
        return logs.join('\n')
    }

    createProcess(key: string | number, command: string): boolean {
        let pro = this._processlist.filter(v => v.key === key)[0]
        if (pro) {
            return false
        }
        const commandArray = command.split(" ")
        let execCommand = checkCommand(commandArray[0])
        let exec = !!execCommand ? forkFn : execa
        let args = commandArray.slice(1)
        let oneProcess: IProcessChild = {
            key: -1,
            command,
            execCommand: {
                cmd: execCommand,
                argu: args,
            },
            log: [],
            status: EProcessStatus.Normal,
            instance: null,
        }
        oneProcess.status = EProcessStatus.Starting
        this.send(key, oneProcess.status)
        let p = exec(execCommand, args, (err, data, isComplete) => {
            if (isComplete) {
                oneProcess.status = EProcessStatus.Exit
                this.send(key, oneProcess.status, iGetInnerText(`${data}`))
                oneProcess.log.push(`${data}`)
                this.clearOneDeath(p)
                return
            }
            if (err) {
                this.send(key, oneProcess.status, err)
                oneProcess.log.push(err)
            } else {
                this.send(key, oneProcess.status, iGetInnerText(`${data}`))
                oneProcess.log.push(iGetInnerText(data))
            }
        })
        p.on("spawn", () => {
            oneProcess.status = EProcessStatus.Running
            this.send(key, oneProcess.status)
        })
        oneProcess.key = key
        oneProcess.instance = p
        this._processlist.push(oneProcess)
        return true
    }

    killAll() {
        let list = this._processlist
        for (let i = 0; i < list.length; i++) {
            const process = list[i]
            const instance = process.instance
            if (instance) {
                process.status = EProcessStatus.Stopping
                this.send(process.key, process.status)
                kill(process.instance)
            }
        }
    }
    kill(key: string | number) {
        let list = this._processlist
        for (let i = 0; i < list.length; i++) {
            const process = list[i]
            if (process.key === key) {
                const instance = process.instance
                if (instance) {
                    process.status = EProcessStatus.Stopping
                    this.send(process.key, process.status)
                    kill(process.instance)
                }
                break
            }
        }
    }
    clearOneDeath(p: ChildProcessWithoutNullStreams) {
        let list = this._processlist
        let len = list.length
        for (let i = len - 1; i >= 0; i--) {
            const process = list[i]
            const instance = process.instance
            if (instance === p) {
                if (process.status === EProcessStatus.Exit || process.status === EProcessStatus.Normal) {
                    kill(process.instance)
                    this._processlist.splice(i, 1)
                }
                if (instance?.killed) {
                    this._processlist.splice(i, 1)
                }
                break
            }
        }
    }
    clearAllDeath() {
        let list = this._processlist
        let len = list.length
        let count = 0
        for (let i = len - 1; i >= 0; i--) {
            const process = list[i]
            const instance = process.instance
            if ((process.status === EProcessStatus.Exit || process.status === EProcessStatus.Normal) && instance) {
                kill(process.instance)
                count++
                this._processlist.splice(i, 1)
            }
            if (instance?.killed) {
                count++
                this._processlist.splice(i, 1)
            }
        }
        console.log("??????" + count + "????????????")
        console.log("????????????" + this._processlist.length + "????????????")
    }
}

const instance = ProcessManager.getInstance()

export default instance

process
    // Handle normal exits
    .on("exit", code => {
        instance.killAll()
        process.exit(code)
    })

    // Handle CTRL+C
    .on("SIGINT", () => {
        instance.killAll()
        process.exit(0)
    })
