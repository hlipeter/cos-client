/**
 * Created by michael on 2017/7/3.
 */
import fs from 'fs'

/**
 * Enum for task status.
 * @readonly
 * @enum {string}
 */
const TaskStatus = {
  WAIT: 'wait',
  RUN: 'run',
  PAUSE: 'pause',
  COMPLETE: 'complete',
  ERROR: 'error'
}

function Tasks (max) {
  let nextId = 0
  let maxActivity = max
  let activity = 0
  this.tasks = []
  this.needSend = false
  this.getId = () => nextId++
  this.add = () => {
    if (activity <= maxActivity) {
      activity++
      return true
    }
    return false
  }
  this.done = () => {
    if (activity > 0) {
      activity--
      return
    }
    throw new Error('broken task status')
  }
  this.full = () => activity >= max
}

Tasks.prototype.newTask = function (task) {
  let id = this.getId()
  task.id = id
  task.status = TaskStatus.WAIT
  this.tasks[id] = task
  this.needSend = true
  return task
}

Tasks.prototype.findTask = function (id) {
  return this.tasks[id]
}

Tasks.prototype.deleteTask = function (id) {
  let t = this.tasks[id]
  delete this.tasks[id]
  this.needSend = true
  return t
}

Tasks.prototype.next = function () {
  if (this.full()) return

  let task = this.tasks.find(t => t && t.status === TaskStatus.WAIT)
  if (!task) return

  task.status = TaskStatus.RUN
  this.add()
  return task.start().then(result => {
    task.status = TaskStatus.COMPLETE
    this.done()
    // todo
    return this.next()
  }, err => {
    task.status = TaskStatus.ERROR
    this.done()
    // todo
    console.log(err)
    return this.next()
  })
}

Tasks.prototype.stop = function () {
  // todo
}

/**
 *
 * @param  {object}   cos
 * @param  {string}   name
 *
 * @param  {object}   params
 * @param  {string}   params.Bucket
 * @param  {string}   params.Region
 * @param  {string}   params.Key
 * @param  {string}   [params.UploadId] 仅续传任务需要
 *
 * @param  {object}   [option]
 * @param  {int}      option.sliceSize
 * @param  {int}      option.asyncLim
 */
function UploadTask (cos, name, params, option = {}) {
  this.cos = cos
  this.params = params
  this.file = {}
  this.progress = {list: [], loaded: 0, total: 0}
  this.asyncLim = option.asyncLim || 2
  this.cancel = false

  return new Promise((resolve, reject) => {
    fs.stat(name, (err, stats) => {
      if (err) {
        reject(err)
        return
      }

      this.file = {
        fileName: name,
        fileSize: stats.size,
        sliceSize: option.sliceSize || 1 << 20
      }

      let n = this.file.fileSize
      this.progress.total = this.file.fileSize
      while (n > this.file.sliceSize) {
        this.progress.list.push({total: this.file.sliceSize})
        n -= this.file.sliceSize
      }
      this.progress.list.push({total: n})

      this.file.iterator = getSliceIterator(this.file)

      this.progress.On = () => {
        setImmediate(() => {
          let loaded = 0
          this.progress.list.forEach(piece => (loaded += piece.loaded || 0))
          this.progress.loaded = loaded
        })
      }

      resolve(this)
    })
  })
}

UploadTask.prototype.start = function () {
  this.cancel = false
  return (this.params.UploadId ? this.getMultipartListPart() : this.multipartInit())
    .then(this.uploadSlice.bind(this))
    .then(this.multipartComplete.bind(this), err => {
      err.params = this.params
      throw err
    })
}

UploadTask.prototype.multipartInit = function () {
  return new Promise((resolve, reject) => {
    this.cos.multipartInit(this.params, (err, result) => {
      if (err) { return reject(err) }
      if (!result.UploadId) { return reject(new Error('null UploadId')) }
      console.info('sliceUploadFile: 创建新上传任务成功，UploadId: ', result.UploadId)
      this.params.UploadId = result.UploadId
      resolve()
    })
  })
}

UploadTask.prototype.getMultipartListPart = function () {
  let list = []
  let params = this.params
  let p = () => new Promise((resolve, reject) => {
    this.cos.multipartListPart(params, (err, result) => {
      if (err) {
        reject(err)
        return
      }

      result.Part.forEach(part => {
        list[part.PartNumber - 1] = {
          PartNumber: part.PartNumber,
          ETag: part.ETag
        }
      })

      if (result.IsTruncated === 'true') {
        params.PartNumberMarker = result.NextPartNumberMarker
        p().then(resolve, reject)
        return
      }
      this.params.Parts = list
      resolve()
    })
  })
  return p()
}

/**
 * @private
 */
UploadTask.prototype.uploadSlice = function () {
  return Promise.all(new Array(this.asyncLim).fill(0).map(() => this.upload()))
}

UploadTask.prototype.upload = function () {
  let item = this.file.iterator.next()
  this.params.Parts = this.params.Parts || []
  if (item.done) {
    return Promise.resolve()
  }

  return item.value.then(result => {
    let pg = this.progress.list[result.index - 1]

    if (this.params.Parts[result.index - 1] &&
      this.params.Parts[result.index - 1].ETag === `"${result.hash}"`) {
      console.info('upload: 秒传', result.index, result.hash)
      pg.loaded = pg.total
      this.progress.On()
      return this.upload()
    }

    return new Promise((resolve, reject) => {
      this.cos.multipartUpload(Object.assign({
        PartNumber: result.index,
        ContentLength: result.length,
        Body: result.body,
        onProgress: (data) => {
          pg.loaded = data.loaded
          this.progress.On()
        }
        // todo 在sdk更新后换成 ContentMD5
        // ContentSha1: '"' + result.hash + '"'
      }, this.params), (err, data) => {
        if (err) {
          reject(err)
          return
        }
        // todo do data need be check?
        if (data.ETag === `"${result.hash}"`) {
          console.info('upload: 分片完成', result.index, result.hash, data)
        } else {
          console.warn('upload: 分片ETag不一致', result.index, result.hash, data)
        }
        if (this.cancel) {
          reject(new Error('upload cancel'))
          return
        }
        this.params.Parts[result.index - 1] = {
          PartNumber: result.index,
          ETag: data.ETag
        }
        this.upload().then(resolve, reject)
      })
    })
  })
}

UploadTask.prototype.multipartComplete = function () {
  return new Promise((resolve, reject) => {
    // todo
    console.log(this.params)
    this.cos.multipartComplete(this.params, (err, result) => {
      err ? reject(err) : resolve(result)
    })
  })
}

UploadTask.prototype.stop = function () {
  this.cancel = true
}

function getSliceMD5 (fileName, index, start, end) {
  // todo 改md5
  let md5 = crypto.createHash('sha1')

  let readStream = fs.createReadStream(fileName, {
    start: start,
    end: end
  })

  return new Promise((resolve, reject) => {
    readStream.on('data', chunk => md5.update(chunk))

    readStream.on('error', reject)

    readStream.on('end', () => resolve({
      index,
      hash: md5.digest('hex'),
      length: end - start + 1,
      body: fs.createReadStream(fileName, {
        start: start,
        end: end
      })
    }))
  })
}

/**
 *
 * @param  {object}   file
 *     @param  {string}   file.fileName
 *     @param  {int}   file.fileSize
 *     @param  {int}   file.sliceSize
 */
function * getSliceIterator (file) {
  let start = 0
  let end = file.sliceSize - 1
  let index = 1

  while (end < file.fileSize - 1) {
    yield getSliceMD5(file.fileName, index, start, end)
    index++
    start = end + 1
    end += file.sliceSize
  }

  yield getSliceMD5(file.fileName, index, start, file.fileSize - 1)
}

/**
 *
 * @param  {object}   cos
 * @param  {string}   name
 *
 * @param  {object}   params
 * @param  {string}   params.Bucket
 * @param  {string}   params.Region
 * @param  {string}   params.Key
 * @param  {string}   [params.UploadId] 仅续传任务需要
 *
 * @param  {object}   [option]
 * @param  {int}      option.sliceSize
 * @param  {int}      option.asyncLim
 */
function MockUploadTask (cos, name, params, option = {}) {
  this.params = params
  this.file = {
    fileName: name
  }
  this.asyncLim = 2
  this.cancel = false
  this.progress = {}
  this.progress.total = 1 << 20
  this.progress.loaded = 0
  return Promise.resolve(this)
}

MockUploadTask.prototype.start = function () {
  return new Promise((resolve, reject) => {
    this.cancel = false
    let p = setInterval(() => {
      if (this.cancel) {
        clearInterval(p)
        return
      }
      this.progress.loaded += 20900
      if (this.progress.loaded >= this.progress.total) {
        this.progress.loaded = this.progress.total
        clearInterval(p)
        resolve()
      }
    }, 100)
  })
}

MockUploadTask.prototype.stop = function () {
  this.cancel = true
}

/**
 *
 * @param  {object}   cos
 * @param  {string}   name
 *
 * @param  {object}   params
 * @param  {string}   params.Bucket
 * @param  {string}   params.Region
 * @param  {string}   params.Key
 *
 * @param  {object}   [option]
 * @param  {int}      option.asyncLim
 */
function DownloadTask (cos, name, params, option = {}) {
  this.cos = cos
  this.params = {
    Bucket: params.Bucket,
    Region: params.Region,
    Key: params.Key
  }
  this.file = {
    fileName: name
  }
  this.progress = {loaded: 0, total: 0}
  this.cancel = false
  return new Promise((resolve, reject) => {
    this.cos.headObject(params, (err, result) => {
      if (err) {
        reject(err)
        return
      }
      this.file.fileSize = parseInt(result['content-length'])
      resolve(this)
    })
  })
}

DownloadTask.prototype.start = function () {
  this.params.Output = fs.createWriteStream(this.file.fileName)

  this.params.Output.on('drain', () => {
    this.progress.loaded = this.params.Output.bytesWritten
    console.log(this.cancel)
    if (this.cancel) {
      this.params.Output.close()
      let err = new Error('cancel')
      err.cancel = true
      this.params.Output.emit('error', err)
      console.log(11)
    }
  })

  return new Promise((resolve, reject) => {
    this.cos.getObject(this.params, (err, result) => {
      if (err) {
        reject(err)
        return
      }
      resolve(result)
    })
  })
}

DownloadTask.prototype.stop = function () {
  this.cancel = true
}

/**
 *
 * @param  {object}   cos
 * @param  {string}   name
 *
 * @param  {object}   params
 * @param  {string}   params.Bucket
 * @param  {string}   params.Region
 * @param  {string}   params.Key
 *
 * @param  {object}   [option]
 * @param  {int}      option.asyncLim
 */
function MockDownloadTask (cos, name, params, option = {}) {
  this.params = params
  this.file = {
    fileName: name
  }
  this.asyncLim = 2
  this.cancel = false
  this.progress = {}
  this.progress.total = 1 << 20
  this.progress.loaded = 0
  return Promise.resolve(this)
}

MockDownloadTask.prototype.start = function () {
  return new Promise((resolve, reject) => {
    this.cancel = false
    let p = setInterval(() => {
      if (this.cancel) {
        clearInterval(p)
        return
      }
      this.progress.loaded += 20900
      if (this.progress.loaded >= this.progress.total) {
        this.progress.loaded = this.progress.total
        clearInterval(p)
        resolve()
      }
    }, 100)
  })
}

MockDownloadTask.prototype.stop = function () {
  this.cancel = true
}

export { TaskStatus, Tasks, UploadTask, MockUploadTask, DownloadTask, MockDownloadTask }
