
//
// From: https://blog.risingstack.com/tutorial-d3-js-calendar-heatmap/
//
//
//

      date_histogram_data.sort((a, b) => new Date(a.Date) - new Date(b.Date));

      const dateValues = date_histogram_data.map(dv => ({
        date: d3.timeDay(new Date(dv.Date)),
        value: Number(dv.NoteCount)
      }));

      const svg = d3.select("#date_histogram_svg");
      const { width, height } = document
        .getElementById("date_histogram_svg")
        .getBoundingClientRect();


      function draw_date_histogram() {
        const years = d3
          .nest()
          .key(d => d.date.getUTCFullYear())
          .entries(dateValues)
          .reverse();

        const values = dateValues.map(c => c.value);
        const maxValue = d3.max(values);
        const minValue = d3.min(values);

        const cellSize = 15;
        const yearHeight = cellSize * 7;

        const group = svg.append("g");

        const year = group
          .selectAll("g")
          .data(years)
          .join("g")
          .attr(
            "transform",
            (d, i) => `translate(50, ${yearHeight * i + cellSize * 1.5})`
          );

        year
          .append("text")
          .attr("x", -5)
          .attr("y", -30)
          .attr("text-anchor", "end")
          .attr("font-size", 16)
          .attr("font-weight", 550)
          .attr("transform", "rotate(270)")
          .text(d => d.key);

        const formatDay = d =>
          ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d.getUTCDay()];
        const countDay = d => d.getUTCDay();
        const timeWeek = d3.utcSunday;
        const formatDate = d3.utcFormat("%x");
        const colorFn = d3
          .scaleSequential(d3.interpolateBuGn)
          .domain([Math.floor(minValue), Math.ceil(maxValue)]);
        const format = d3.format("+.2%");

        year
          .append("g")
          .attr("text-anchor", "end")
          .selectAll("text")
          .data(d3.range(7).map(i => new Date(1995, 0, i)))
          .join("text")
          .attr("x", -5)
          .attr("y", d => (countDay(d) + 0.5) * cellSize)
          .attr("dy", "0.31em")
          .attr("font-size", 12)
          .text(formatDay);

        year
          .append("g")
          .selectAll("rect")
          .data(d => d.values)
          .join("rect")
          .attr("width", cellSize - 1.5)
          .attr("height", cellSize - 1.5)
          .attr(
            "x",
            (d, i) => timeWeek.count(d3.utcYear(d.date), d.date) * cellSize + 10
          )
          .attr("y", d => countDay(d.date) * cellSize + 0.5)
          .attr("fill", d => colorFn(d.value))
          .append("svg:title")
          .text(d => `${formatDate(d.date)}: ${d.value} notes`)
          ;

        const categoriesCount = 10;
        const categories = [...Array(categoriesCount)].map((_, i) => {
          const upperBound = (maxValue / categoriesCount) * (i + 1);
          const lowerBound = (maxValue / categoriesCount) * i;

          return {
            upperBound,
            lowerBound,
            color: d3.interpolateBuGn(upperBound / maxValue),
            selected: true
          };
        });
      }
