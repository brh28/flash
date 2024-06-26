module.exports = {
  async up(db) {
    console.log("removing phonecodes")
    const collectionList = await db.listCollections({ name: "phonecodes" }).toArray()
    if (collectionList.length > 0) {
      const updated = await db.collection("phonecodes").drop()
      console.log({ updated }, "phonecodes removed")
    }
    console.log("phonecodes already removed")
  },
}
